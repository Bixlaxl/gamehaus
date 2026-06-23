import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = 'nodejs';

export async function GET() {
  const admin = createAdminClient();
  
  const { data: payments, error: pErr } = await admin
    .from("payments")
    .select("*")
    .order("collected_at", { ascending: false })
    .limit(5);
    
  const { data: orders, error: oErr } = await admin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  return NextResponse.json({ payments, orders, pErr, oErr });
}
