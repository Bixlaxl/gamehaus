import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

function fuzzyMatch(name1: string, name2: string): boolean {
  const norm1 = name1.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  const norm2 = name2.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

  if (norm1 === norm2) return true;
  if (!norm1 || !norm2) return false;

  // Split into tokens
  const tokens1 = norm1.split(" ");
  const tokens2 = norm2.split(" ");

  // Check if all tokens of one name are included in the other name (subset check)
  const all1In2 = tokens1.every(t => tokens2.includes(t));
  const all2In1 = tokens2.every(t => tokens1.includes(t));
  if (all1In2 || all2In1) return true;

  // Levenshtein Distance helper
  const getLevenshteinDistance = (a: string, b: string): number => {
    const tmp: number[][] = [];
    for (let i = 0; i <= a.length; i++) {
      tmp[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
      tmp[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        tmp[i][j] = Math.min(
          tmp[i - 1][j] + 1,
          tmp[i][j - 1] + 1,
          tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return tmp[a.length][b.length];
  };

  // If edit distance is very small relative to the length
  const dist = getLevenshteinDistance(norm1, norm2);
  const maxLen = Math.max(norm1.length, norm2.length);
  // Allow 1 typo for short names, 2 for medium names, 3 for long names
  const allowedDist = maxLen <= 5 ? 1 : maxLen <= 10 ? 2 : 3;
  
  return dist <= allowedDist;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone    = searchParams.get("phone")?.trim();
  const nameParam = searchParams.get("name")?.trim();

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
      .select("id, short_id, bound_table_ids, free_hours_ledger, plan:membership_plans(*)")
      .eq("customer_phone", phone)
      .eq("is_active", true)
      .lte("starts_at", nowIso)
      .gte("expires_at", nowIso)
      .order("starts_at", { ascending: false }),
  ]);

  const data = profileResult.data;
  if (!data) {
    return NextResponse.json({ found: false, customer: null, is_new: true });
  }

  // Use fuzzy matching logic to verify if the typed name closely matches the registered name
  if (nameParam) {
    const storedName = data.name ?? "";
    if (!fuzzyMatch(nameParam, storedName)) {
      return NextResponse.json({
        found: false,
        error: "mismatch",
        customer: null,
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
      bound_table_ids: (m.bound_table_ids && m.bound_table_ids.length > 0) ? m.bound_table_ids : (planObj?.bound_table_ids || []),
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
