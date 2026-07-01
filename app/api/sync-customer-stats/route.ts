import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const admin = createAdminClient();

    // 1. Fetch all customer profiles
    const { data: profiles, error: profError } = await admin
      .from("customer_profiles")
      .select("phone, name, visit_count, total_spent");

    if (profError || !profiles) {
      throw new Error(profError?.message || "Failed to fetch profiles");
    }

    // 2. Fetch all finalized orders
    const { data: orders, error: ordError } = await admin
      .from("orders")
      .select("customer_phone, amount_due, advance_paid")
      .eq("status", "finalized");

    if (ordError || !orders) {
      throw new Error(ordError?.message || "Failed to fetch orders");
    }

    // 3. Map orders by phone
    const spentMap = new Map<string, number>();
    const countMap = new Map<string, number>();

    for (const o of orders) {
      if (!o.customer_phone) continue;
      const phone = o.customer_phone.trim();
      const amount = (o.amount_due ?? 0) + (o.advance_paid ?? 0);

      spentMap.set(phone, (spentMap.get(phone) ?? 0) + amount);
      countMap.set(phone, (countMap.get(phone) ?? 0) + 1);
    }

    // 4. Update each profile
    const updates = [];
    for (const p of profiles) {
      const phone = p.phone.trim();
      const newSpent = spentMap.get(phone) ?? 0;
      const newCount = countMap.get(phone) ?? 0;

      updates.push(
        admin
          .from("customer_profiles")
          .update({
            total_spent: newSpent,
            visit_count: newCount,
          })
          .eq("phone", p.phone)
      );
    }

    await Promise.all(updates);

    return NextResponse.json({
      success: true,
      message: `Successfully synchronized ${profiles.length} customer profiles.`,
      updatedProfiles: profiles.map((p) => ({
        phone: p.phone,
        name: p.name,
        previousSpent: p.total_spent,
        newSpent: spentMap.get(p.phone.trim()) ?? 0,
        previousVisits: p.visit_count,
        newVisits: countMap.get(p.phone.trim()) ?? 0,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
