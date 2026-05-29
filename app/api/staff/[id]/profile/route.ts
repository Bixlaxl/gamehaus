import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

/**
 * Owner-only staff detail page data.
 *
 * Returns:
 *   - profile: identity + assignment + login (owner-only — never expose elsewhere)
 *   - stats:   bills_collected / walk_ins_started / extras_added / avg_ticket
 *              broken out across three windows (today / 7d / 30d)
 *   - activity: most-recent 50 staff actions merged across audit-trail tables
 */
type ActivityType = "bill" | "walk_in" | "extra" | "no_show";

interface ActivityItem {
  type:           ActivityType;
  timestamp:      string;
  customer_name:  string | null;
  amount:         number | null;
  order_id:       string | null;
  description:    string;
}

interface StatsBucket {
  bills_collected:   { count: number; total: number };
  walk_ins_started:  { count: number; total: number };
  extras_added:      { count: number; total: number };
  avg_ticket:        number;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Owner-only gate
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
  const { data: viewer } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();
  if (viewer?.role !== "owner") {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // 1. Profile
  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("id, name, email, role, location_id, is_active, created_at, login_password, locations(name)")
    .eq("id", id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json(err("Staff not found", "NOT_FOUND"), { status: 404 });
  }

  // Time windows
  const now      = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7  * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // 2. Stats — run all queries in parallel across the three windows
  async function computeStats(since: Date): Promise<StatsBucket> {
    const sinceIso = since.toISOString();
    const [
      { data: pays },
      { data: walkins },
      { data: extras },
    ] = await Promise.all([
      admin.from("payments")
        .select("amount")
        .eq("collected_by", id)
        .eq("status", "completed")
        .gte("collected_at", sinceIso),
      admin.from("orders")
        .select("id, amount_due, advance_paid")
        .eq("created_by", id)
        .eq("type", "walk_in")
        .gte("created_at", sinceIso),
      admin.from("order_extras")
        .select("price, quantity")
        .eq("added_by", id)
        .eq("is_deleted", false)
        .gte("created_at", sinceIso),
    ]);

    const billsTotal   = (pays ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
    const walkinsTotal = (walkins ?? []).reduce((s, o) => s + ((o.amount_due ?? 0) + (o.advance_paid ?? 0)), 0);
    const extrasTotal  = (extras ?? []).reduce((s, e) => s + (e.price * e.quantity), 0);

    return {
      bills_collected:  { count: pays?.length ?? 0,    total: billsTotal },
      walk_ins_started: { count: walkins?.length ?? 0, total: walkinsTotal },
      extras_added:     { count: extras?.length ?? 0,  total: extrasTotal },
      avg_ticket:       (pays && pays.length > 0) ? billsTotal / pays.length : 0,
    };
  }

  const [statsToday, stats7d, stats30d] = await Promise.all([
    computeStats(todayStart),
    computeStats(sevenDaysAgo),
    computeStats(thirtyDaysAgo),
  ]);

  // 3. Activity feed — pull ~50 most recent from each source, merge, sort, cap at 50
  const LIMIT_PER_SOURCE = 50;
  const [
    { data: recentPays },
    { data: recentWalkins },
    { data: recentExtras },
    { data: recentNoshows },
  ] = await Promise.all([
    admin.from("payments")
      .select("amount, collected_at, order:orders(id, customer_name)")
      .eq("collected_by", id)
      .eq("status", "completed")
      .order("collected_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
    admin.from("orders")
      .select("id, customer_name, created_at")
      .eq("created_by", id)
      .eq("type", "walk_in")
      .order("created_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
    admin.from("order_extras")
      .select("name, price, quantity, created_at, order:orders(id, customer_name)")
      .eq("added_by", id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
    admin.from("bookings")
      .select("no_show_marked_at, order:orders(id, customer_name)")
      .eq("no_show_marked_by", id)
      .not("no_show_marked_at", "is", null)
      .order("no_show_marked_at", { ascending: false })
      .limit(LIMIT_PER_SOURCE),
  ]);

  const activity: ActivityItem[] = [
    ...(recentPays ?? []).map<ActivityItem>((p) => {
      const order = p.order as unknown as { id: string; customer_name: string } | null;
      return {
        type:          "bill",
        timestamp:     p.collected_at!,
        customer_name: order?.customer_name ?? null,
        amount:        p.amount,
        order_id:      order?.id ?? null,
        description:   `Collected bill of ₹${p.amount}`,
      };
    }),
    ...(recentWalkins ?? []).map<ActivityItem>((o) => ({
      type:          "walk_in",
      timestamp:     o.created_at!,
      customer_name: o.customer_name,
      amount:        null,
      order_id:      o.id,
      description:   `Started walk-in for ${o.customer_name}`,
    })),
    ...(recentExtras ?? []).map<ActivityItem>((e) => {
      const order = e.order as unknown as { id: string; customer_name: string } | null;
      const total = e.price * e.quantity;
      return {
        type:          "extra",
        timestamp:     e.created_at!,
        customer_name: order?.customer_name ?? null,
        amount:        total,
        order_id:      order?.id ?? null,
        description:   `Added ${e.name} ×${e.quantity} (₹${total})`,
      };
    }),
    ...(recentNoshows ?? []).map<ActivityItem>((b) => {
      const order = b.order as unknown as { id: string; customer_name: string } | null;
      return {
        type:          "no_show",
        timestamp:     b.no_show_marked_at!,
        customer_name: order?.customer_name ?? null,
        amount:        null,
        order_id:      order?.id ?? null,
        description:   `Marked ${order?.customer_name ?? "booking"} as no-show`,
      };
    }),
  ];

  activity.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivity = activity.slice(0, 50);

  const lastActiveAt = recentActivity[0]?.timestamp ?? null;

  return NextResponse.json(ok({
    profile: {
      id:              profile.id,
      name:            profile.name,
      email:           profile.email,
      role:            profile.role,
      location_id:     profile.location_id,
      location_name:   (profile.locations as unknown as { name: string } | null)?.name ?? null,
      is_active:       profile.is_active,
      created_at:      profile.created_at,
      login_password:  profile.login_password,
      last_active_at:  lastActiveAt,
    },
    stats: {
      today:   statsToday,
      last_7d: stats7d,
      last_30d: stats30d,
    },
    activity: recentActivity,
  }));
}
