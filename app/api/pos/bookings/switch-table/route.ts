import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

const schema = z.object({
  booking_id:      z.string().uuid(),
  target_table_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }
  const { booking_id, target_table_id } = parsed.data;

  const admin = createAdminClient();
  
  // 1. Fetch user role & location
  const { data: viewer } = await admin
    .from("users")
    .select("role, location_id")
    .eq("id", session.user.id)
    .single();

  if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
    return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
  }

  // 2. Fetch booking and target table details
  const [bookingResult, targetResult] = await Promise.all([
    admin
      .from("bookings")
      .select("*, order_item:order_items(*, table:tables(*))")
      .eq("id", booking_id)
      .single(),
    admin
      .from("tables")
      .select("*")
      .eq("id", target_table_id)
      .single(),
  ]);

  if (bookingResult.error || !bookingResult.data) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }
  if (targetResult.error || !targetResult.data) {
    return NextResponse.json(err("Target table not found", "NOT_FOUND"), { status: 404 });
  }

  const booking = bookingResult.data;
  const orderItem = booking.order_item as any;
  const sourceTable = orderItem?.table as any;
  const targetTable = targetResult.data;

  if (!orderItem || !sourceTable) {
    return NextResponse.json(err("Source table or order item not found", "NOT_FOUND"), { status: 404 });
  }

  // 3. Location Check
  if (sourceTable.location_id !== targetTable.location_id) {
    return NextResponse.json(err("Source and target tables must belong to the same location", "VALIDATION_ERROR"), { status: 400 });
  }

  // Staff role constraint
  if (viewer.role === "staff" && viewer.location_id !== sourceTable.location_id) {
    return NextResponse.json(err("This location belongs to a different staff", "FORBIDDEN"), { status: 403 });
  }

  // 4. "Medium" Table constraints
  const sourceName = (sourceTable.name ?? "").toLowerCase();
  const targetName = (targetTable.name ?? "").toLowerCase();
  if (!sourceName.includes("medium") || !targetName.includes("medium")) {
    return NextResponse.json(err("Table switching is only allowed for Medium tables", "VALIDATION_ERROR"), { status: 400 });
  }

  // 5. Conflict Check on Target Table
  const startMs = new Date(booking.scheduled_start).getTime();
  const endMs   = new Date(booking.scheduled_end).getTime();

  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, table_id, actual_start, expected_end, scheduled_start, scheduled_end, status")
      .eq("table_id", target_table_id)
      .neq("id", booking.order_item_id)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"]),
    admin
      .from("bookings")
      .select("id, scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("status", "confirmed")
      .neq("id", booking_id)
      .eq("order_items.table_id", target_table_id),
  ]);

  const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && aE > bS;
  let isConflict = false;

  for (const ex of (existingItems ?? [])) {
    const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
    const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
    if (exS && exE && overlaps(startMs, endMs, new Date(exS).getTime(), new Date(exE).getTime())) {
      isConflict = true;
      break;
    }
  }

  if (!isConflict) {
    for (const b of (existingBookings ?? [])) {
      if (!b.scheduled_start || !b.scheduled_end) continue;
      if (overlaps(startMs, endMs, new Date(b.scheduled_start).getTime(), new Date(b.scheduled_end).getTime())) {
        isConflict = true;
        break;
      }
    }
  }

  if (isConflict) {
    return NextResponse.json(err("Conflict: target table already has a session or booking in this window", "TABLE_TAKEN"), { status: 409 });
  }

  // 6. Perform the table switch
  const { error: updateError } = await admin
    .from("order_items")
    .update({ table_id: target_table_id })
    .eq("id", booking.order_item_id);

  if (updateError) {
    return NextResponse.json(err(updateError.message, "DB_ERROR"), { status: 500 });
  }

  return NextResponse.json(ok({ success: true }));
}
