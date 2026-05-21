import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  if (!locationId) return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders!inner(customer_name, customer_phone, location_id, advance_paid),
      order_item:order_items!order_item_id(table_id, status)
    `)
    .eq("orders.location_id", locationId)
    .gte("scheduled_start", today.toISOString())
    .lt("scheduled_start", tomorrow.toISOString())
    .in("status", ["confirmed"]);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  type BookingRow = typeof data extends (infer T)[] | null ? T : never;
  const seenIds = new Set<string>();
  const filtered = (data ?? [])
    .filter((b: BookingRow) => {
      if (seenIds.has(b.id)) return false;
      seenIds.add(b.id);
      return true;
    })
    .map((b: BookingRow) => {
      const order = b.order as { customer_name: string; customer_phone: string | null; location_id: string; advance_paid: number } | null;
      return {
        ...b,
        order: {
          customer_name:  order?.customer_name,
          customer_phone: order?.customer_phone,
          advance_paid:   order?.advance_paid ?? 0,
        },
      };
    });

  return NextResponse.json(ok(filtered));
}
