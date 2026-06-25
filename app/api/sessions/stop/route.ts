import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stopSessionSchema, ok, err } from "@/lib/validators/schemas";
import { calculateBill } from "@/lib/billing/engine";
import type { OrderItem } from "@/lib/supabase/types";

export const runtime = 'edge';
export const dynamic = "force-dynamic";


export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = stopSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { order_item_id } = parsed.data;
  const admin = createAdminClient();

  const { data: item, error: itemError } = await admin
    .from("order_items")
    .select("*")
    .eq("id", order_item_id)
    .single();

  if (itemError || !item) {
    return NextResponse.json(err("Order item not found", "NOT_FOUND"), { status: 404 });
  }

  if (item.status !== "running") {
    return NextResponse.json(err("Session is not running", "INVALID_STATE"), { status: 400 });
  }

  const now = new Date();
  const bill = calculateBill([item as OrderItem], [], now);
  const finalAmount = bill.tableLines[0]?.amount ?? 0;

  const { error: updateError } = await admin
    .from("order_items")
    .update({
      status: "finished",
      actual_end: now.toISOString(),
      final_amount: finalAmount,
    })
    .eq("id", order_item_id);

  if (updateError) {
    return NextResponse.json(err(updateError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ stopped_at: now.toISOString(), final_amount: finalAmount }));
}
