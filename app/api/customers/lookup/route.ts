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

  const memberships = (membershipResult.data || []).map((m: any) => ({
    id: m.id,
    short_id: m.short_id || "",
    bound_table_ids: m.bound_table_ids || [],
    free_hours_ledger: m.free_hours_ledger || {},
    plan: m.plan ? (Array.isArray(m.plan) ? m.plan[0] : m.plan) : null,
  }));

  const primaryMembership = memberships[0] || null;
  const membershipDiscountPct = primaryMembership?.plan?.discount_pct ?? 0;
  const membershipId = primaryMembership?.id ?? null;
  const boundTableIds = primaryMembership?.bound_table_ids ?? [];
  const freeHoursLedger = primaryMembership?.free_hours_ledger ?? {};

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
