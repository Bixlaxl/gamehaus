import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

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
      order:orders!inner(customer_name, customer_phone, location_id),
      order_item:order_items(table_id)
    `)
    .gte("scheduled_start", today.toISOString())
    .lt("scheduled_start", tomorrow.toISOString())
    .in("status", ["confirmed"]);

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  // Filter by location (via joined order) and strip internal field
  const filtered = (data ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.order?.location_id === locationId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => ({
      ...b,
      order: {
        customer_name:  b.order.customer_name,
        customer_phone: b.order.customer_phone,
      },
    }));

  return NextResponse.json(ok(filtered));
}
