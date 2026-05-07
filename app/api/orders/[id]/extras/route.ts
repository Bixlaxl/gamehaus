import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { addExtraSchema, ok, err } from "@/lib/validators/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = addExtraSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  // Verify order exists and is open
  const { data: order } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .single();

  if (!order || order.status !== "open") {
    return NextResponse.json(err("Order not found or not open", "INVALID_STATE"), { status: 400 });
  }

  const { name, price, quantity } = parsed.data;

  const { data: extra, error } = await supabase
    .from("order_extras")
    .insert({
      order_id: orderId,
      name,
      price,
      quantity,
      added_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok(extra));
}
