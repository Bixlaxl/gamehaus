import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";
import { getOperatingDate } from "@/lib/utils";

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

  const allOrders = (data ?? []).filter((o) => !(o.type === "online" && (o.advance_paid ?? 0) === 0 && !o.created_by));
  const todayStr = getOperatingDate(new Date());

  const isOrderActiveToday = (o: any): boolean => {
    if (o.created_at && getOperatingDate(new Date(o.created_at)) === todayStr) return true;
    for (const item of o.items ?? []) {
      if (item.scheduled_start && getOperatingDate(new Date(item.scheduled_start)) === todayStr) return true;
      if (item.actual_start && getOperatingDate(new Date(item.actual_start)) === todayStr) return true;
      if (item.actual_end && getOperatingDate(new Date(item.actual_end)) === todayStr) return true;
      if (item.checked_in_at && getOperatingDate(new Date(item.checked_in_at)) === todayStr) return true;
    }
    return false;
  };

  const orderHasDue = (o: any): boolean => {
    if (Number(o.amount_due) > 0) return true;

    const activeItems = (o.items ?? []).filter((i: any) => i.status !== "cancelled" && !i.is_deleted);
    const activeExtras = (o.extras ?? []).filter((e: any) => !e.is_deleted && !e.name?.startsWith("[PENDING]"));

    const tableSubtotal = activeItems.reduce((sum: number, it: any) => {
      if (it.final_amount != null) return sum + Number(it.final_amount);
      if (it.rate_per_hour && it.actual_start) {
        const endMs = it.expected_end
          ? new Date(it.expected_end).getTime()
          : it.actual_end
          ? new Date(it.actual_end).getTime()
          : Date.now();
        const mins = Math.max(0, Math.ceil((endMs - new Date(it.actual_start).getTime()) / 60000));
        return sum + (mins / 60) * it.rate_per_hour;
      }
      if (it.rate_per_hour && it.scheduled_duration_mins) {
        return sum + (it.scheduled_duration_mins / 60) * it.rate_per_hour;
      }
      return sum;
    }, 0);

    const extrasSubtotal = activeExtras.reduce(
      (sum: number, e: any) => sum + (Number(e.price) * Number(e.quantity) || 0),
      0
    );

    const totalSubtotal = Math.max(Number(o.subtotal) || 0, Math.round((tableSubtotal + extrasSubtotal) * 100) / 100);

    const pubDisc = (() => {
      const pub = Number(o.public_discount_amount);
      if (!isNaN(pub) && pub > 0) return pub;
      const disc = Number(o.discount_amount);
      if (!isNaN(disc) && disc > 0) return disc;
      return 0;
    })();

    const advancePaid = Number(o.advance_paid) || 0;
    const pointsRedeemed = Number(o.points_redeemed) || 0;

    const netDue = Math.round((totalSubtotal - pubDisc - advancePaid - pointsRedeemed) * 100) / 100;
    return netDue > 0.5;
  };

  const orders = allOrders.filter((o) => {
    const isToday = isOrderActiveToday(o);
    const hasRunning = o.items?.some((i: any) => i.status === "running");
    const hasScheduled = o.items?.some((i: any) => i.status === "scheduled");
    const hasDue = orderHasDue(o);
    return isToday || hasRunning || hasScheduled || hasDue;
  });
  // Orders are filtered cleanly in memory for the active shift without mutating DB during GET polling.

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
