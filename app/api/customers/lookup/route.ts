import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get("phone")?.trim();

  if (!phone || phone.length < 6) {
    return NextResponse.json({ found: false, customer: null });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_profiles")
    .select("name, points_balance, visit_count, total_spent")
    .eq("phone", phone)
    .single();

  if (!data) {
    return NextResponse.json({ found: false, customer: null });
  }

  return NextResponse.json({
    found: true,
    customer: {
      name:           data.name,
      points_balance: data.points_balance,
      visit_count:    data.visit_count,
      total_spent:    data.total_spent,
    },
  });
}
