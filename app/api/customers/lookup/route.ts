import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone    = searchParams.get("phone")?.trim();
  const nameParam = searchParams.get("name")?.trim().toLowerCase();

  if (!phone || phone.length < 6) {
    return NextResponse.json({ found: false, customer: null });
  }

  const admin = createAdminClient();
  // Profile + active membership in parallel — the membership discount has to
  // flow back to the finalize modal so its displayed Total Due matches what
  // the server actually charges. Without this, an active membership silently
  // shaved the bill server-side and the modal's payment-total check failed
  // with "Payment total ₹X does not match bill ₹Y".
  const nowIso = new Date().toISOString();
  const [profileResult, membershipResult] = await Promise.all([
    admin
      .from("customer_profiles")
      .select("name, points_balance, visit_count, total_spent")
      .eq("phone", phone)
      .single(),
    admin
      .from("customer_memberships")
      .select("id, short_id, bound_table_ids, free_hours_ledger, plan:membership_plans(name, discount_pct, free_hrs)")
      .eq("customer_phone", phone)
      .eq("is_active", true)
      .lte("starts_at", nowIso)
      .gte("expires_at", nowIso)
      .order("starts_at", { ascending: false }),
  ]);

  const data = profileResult.data;
  if (!data) {
    return NextResponse.json({ found: false, customer: null });
  }

  // If name is provided (public website), require it to match — prevents
  // guessing phone numbers from seeing points / membership. On mismatch we
  // still surface a name_mismatch hint with the stored name so the checkout
  // page can show the same "Use existing / Update name" popup the staff sees.
  if (nameParam) {
    const storedName = (data.name ?? "").toLowerCase().trim();
    if (storedName !== nameParam) {
      return NextResponse.json({
        found:         false,
        customer:      null,
        name_mismatch: true,
        stored_name:   data.name,
      });
    }
  }

  const memberships = (membershipResult.data || []).map((m: any) => {
    const planObj = m.plan ? (Array.isArray(m.plan) ? m.plan[0] : m.plan) : null;
    const planFreeHrs = Number(planObj?.free_hrs || 0);
    const ledger: Record<string, number> = { ...(m.free_hours_ledger || {}) };
    if (planFreeHrs > 0 && Object.keys(ledger).length === 0) {
      ["snooker", "pool", "ps5", "foosball", "simulator", "standard"].forEach((t) => {
        ledger[t] = planFreeHrs;
      });
    }
    return {
      id: m.id,
      short_id: m.short_id || "",
      bound_table_ids: m.bound_table_ids || [],
      free_hours_ledger: ledger,
      plan: planObj,
    };
  });


  // Highest discount percentage across all active memberships
  const membershipDiscountPct = memberships.reduce((max: number, m: any) => {
    const pct = m.plan?.discount_pct ?? 0;
    return pct > max ? pct : max;
  }, 0);

  // We find the primary Free Hours membership (if any) or fallback to memberships[0]
  const freeHoursMembership = memberships.find((m: any) => Number(m.plan?.free_hrs || 0) > 0) || memberships[0] || null;
  const membershipId = freeHoursMembership?.id ?? null;
  const boundTableIds = freeHoursMembership?.bound_table_ids ?? [];
  const freeHoursLedger = freeHoursMembership?.free_hours_ledger ?? {};

  return NextResponse.json({
    found: true,
    customer: {
      name:                    data.name,
      points_balance:          data.points_balance,
      visit_count:             data.visit_count,
      total_spent:             data.total_spent,
      membership_discount_pct: membershipDiscountPct,
      membership_id:           membershipId,
      bound_table_ids:         boundTableIds,
      free_hours_ledger:       freeHoursLedger,
      active_memberships:      memberships,
    },
  });
}
