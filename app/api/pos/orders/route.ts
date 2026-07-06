import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

async function autoMarkNoShows(admin: ReturnType<typeof createAdminClient>, locationId: string) {
  try {
    const now = new Date().toISOString();
    const { data: expiredBookings } = await admin
      .from("bookings")
      .select("id, order:orders!inner(location_id)")
      .eq("status", "confirmed")
      .eq("orders.location_id", locationId)
      .lte("scheduled_end", now);

    if (expiredBookings && expiredBookings.length > 0) {
      const expiredIds = expiredBookings.map((b: any) => b.id);
      await admin
        .from("bookings")
        .update({
          status: "no_show",
          no_show_marked_at: now,
        })
        .in("id", expiredIds);
    }
  } catch (err) {
    console.error("Failed to auto-mark no-shows:", err);
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  if (!locationId) return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });

  const admin = createAdminClient();
  await autoMarkNoShows(admin, locationId);

  const { data, error } = await admin
    .from("orders")
    .select("*, items:order_items(*, table:tables(*)), extras:order_extras(*)")
    .eq("location_id", locationId)
    .eq("status", "open");

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  const orders = (data ?? []).filter((o) => !(o.type === "online" && (o.advance_paid ?? 0) === 0 && !o.created_by));
  const phones = Array.from(new Set(orders.map((o) => o.customer_phone).filter((p): p is string => !!p)));

  let profileMap: Record<string, number> = {};
  if (phones.length > 0) {
    const { data: profiles } = await admin
      .from("customer_profiles")
      .select("phone, points_balance")
      .in("phone", phones);
    if (profiles) {
      profileMap = Object.fromEntries(profiles.map((p) => [p.phone, p.points_balance]));
    }
  }

  const ordersWithPoints = orders.map((o) => ({
    ...o,
    customer_points: o.customer_phone ? (profileMap[o.customer_phone] ?? 0) : 0,
  }));

  return NextResponse.json(ok(ordersWithPoints));
}
