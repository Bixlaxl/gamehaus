import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateBill } from "@/lib/billing/engine";
import { ok, err } from "@/lib/validators/schemas";
import type { OrderItem, OrderExtra } from "@/lib/supabase/types";

export const runtime = "edge";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const admin = createAdminClient();

  const body = await request.json().catch(() => ({})) as {
    coupon_code?: string;
    customer_phone?: string;
  };

  // Fetch order, items, and extras in parallel
  const [
    { data: order, error: orderError },
    { data: items },
    { data: extras },
  ] = await Promise.all([
    admin.from("orders").select("*, coupon:coupons(*)").eq("id", orderId).single(),
    admin.from("order_items").select("*, table:tables(*)").eq("order_id", orderId).eq("is_deleted", false),
    admin.from("order_extras").select("*").eq("order_id", orderId).eq("is_deleted", false),
  ]);

  if (orderError || !order) {
    return NextResponse.json(err("Order not found", "NOT_FOUND"), { status: 404 });
  }

  const effectivePhone = body.customer_phone || order.customer_phone;
  const now = new Date();

  // Fetch active memberships for customer
  const { data: allMemberships } = await (effectivePhone
    ? admin
        .from("customer_memberships")
        .select("*, plan:membership_plans(*)")
        .eq("customer_phone", effectivePhone)
        .eq("is_active", true)
        .gte("expires_at", now.toISOString())
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [] }));

  const memberships: any[] = allMemberships ?? [];
  const membershipDiscountPct = memberships.reduce((max, m) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);

  const ledgerUpdates: Map<string, { id: string; ledger: Record<string, number>; hoursRedeemed: number; freeHrsUsed: number }> = new Map();
  memberships.forEach(m => {
    const planFreeHrs = Number(m.plan?.free_hrs || 0);
    const ledger: Record<string, number> = { ...(m.free_hours_ledger as Record<string, number> || {}) };
    if (planFreeHrs > 0 && Object.keys(ledger).length === 0) {
      ["snooker", "pool", "ps5", "foosball", "simulator", "standard"].forEach((t) => {
        ledger[t] = planFreeHrs;
      });
    }
    ledgerUpdates.set(m.id, {
      id: m.id,
      ledger,
      hoursRedeemed: 0,
      freeHrsUsed: Number(m.free_hrs_used || 0),
    });
  });

  let totalFreeHoursDiscount = 0;
  const activeItems = (items ?? []).filter((i) => i.status !== "cancelled");

  for (const item of activeItems) {
    const table = (item as any).table;
    if (!table) continue;

    const itemMembershipId = (item as any).membership_id;
    const isBound = (m: any) => !m.bound_table_ids || m.bound_table_ids.length === 0 || m.bound_table_ids.includes(table.id);
    let coveringMembership = itemMembershipId
      ? memberships.find(m => m.id === itemMembershipId && isBound(m))
      : memberships.find(m => isBound(m));

    if (!coveringMembership) continue;

    const ledgerEntry = ledgerUpdates.get(coveringMembership.id)!;
    const tableType = table.type || "";
    const remainingFreeHrs = Number(ledgerEntry.ledger[tableType]) || 0;
    if (remainingFreeHrs <= 0) continue;

    let durationHrs = 0;
    if (item.scheduled_start && item.scheduled_end) {
      durationHrs = (new Date(item.scheduled_end).getTime() - new Date(item.scheduled_start).getTime()) / (3600 * 1000);
    } else if (item.scheduled_duration_mins) {
      durationHrs = item.scheduled_duration_mins / 60;
    }

    let maxRedeem = Math.min(durationHrs, remainingFreeHrs);
    if (typeof item.free_hours_to_redeem === "number" && item.free_hours_to_redeem >= 0) {
      maxRedeem = Math.min(maxRedeem, item.free_hours_to_redeem);
    }

    const freeHoursDiscount = maxRedeem * (item.rate_per_hour || 0);
    totalFreeHoursDiscount += freeHoursDiscount;
    ledgerEntry.hoursRedeemed += maxRedeem;
    ledgerEntry.ledger[tableType] = Math.max(0, Math.round((remainingFreeHrs - maxRedeem) * 100) / 100);
  }

  const bill = calculateBill(
    activeItems as OrderItem[],
    (extras ?? []) as OrderExtra[],
    now,
    order.coupon,
    0,
    order.discount_amount ?? 0,
    membershipDiscountPct,
    totalFreeHoursDiscount
  );

  const totalDiscount = Math.round((bill.discountAmount + bill.memberDiscountAmount + bill.freeHoursDiscountAmount) * 100) / 100;
  const netAdvancePaid = Math.max(0, bill.subtotal - totalDiscount);

  const membershipUpdatePromises = Array.from(ledgerUpdates.values())
    .filter(e => e.hoursRedeemed > 0)
    .map(e =>
      admin.from("customer_memberships").update({
        free_hours_ledger: e.ledger,
        free_hrs_used: e.freeHrsUsed + e.hoursRedeemed,
      }).eq("id", e.id)
    );

  const primaryMembership = memberships.find(m => {
    const e = ledgerUpdates.get(m.id);
    return e && e.hoursRedeemed > 0;
  }) ?? memberships[0] ?? null;

  await Promise.all([
    admin
      .from("orders")
      .update({
        status: "open",
        subtotal: bill.subtotal,
        discount_amount: totalDiscount,
        total_amount: netAdvancePaid,
        advance_paid: netAdvancePaid,
        amount_due: 0,
        membership_id: order.membership_id ?? primaryMembership?.id ?? null,
      })
      .eq("id", orderId),
    ...membershipUpdatePromises,
  ]);

  return NextResponse.json(ok({ order_id: orderId }));
}
