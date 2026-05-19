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
  const { data } = await admin
    .from("customer_profiles")
    .select("name, points_balance, visit_count, total_spent")
    .eq("phone", phone)
    .single();

  if (!data) {
    return NextResponse.json({ found: false, customer: null });
  }

  // If name is provided (public website), require it to match — prevents guessing phone numbers
  if (nameParam) {
    const storedName = (data.name ?? "").toLowerCase().trim();
    if (storedName !== nameParam) {
      return NextResponse.json({ found: false, customer: null });
    }
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
