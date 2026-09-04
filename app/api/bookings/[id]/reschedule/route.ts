import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { z } from "zod";

export const runtime = 'edge';


const schema = z.object({
  shift_mins: z.number().int().min(15).max(120).optional(),
  new_start: z.string().datetime().optional(),
  new_end: z.string().datetime().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: bookingId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body: unknown = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(err(parsed.error.errors[0].message, "VALIDATION_ERROR"), { status: 400 });
  }

  const { shift_mins, new_start, new_end } = parsed.data;
  const admin = createAdminClient();

  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select("*, order_item:order_items!inner(id, table_id, scheduled_start, scheduled_end), order:orders!inner(id, location_id)")
    .eq("id", bookingId)
    .single();

  if (bErr || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json(err("Can only reschedule confirmed bookings", "INVALID_STATE"), { status: 400 });
  }

  let finalStart = "";
  let finalEnd = "";

  if (new_start && new_end) {
    finalStart = new_start;
    finalEnd = new_end;
  } else if (shift_mins) {
    const shiftMs = shift_mins * 60 * 1000;
    finalStart = new Date(new Date(booking.scheduled_start).getTime() + shiftMs).toISOString();
    finalEnd = new Date(new Date(booking.scheduled_end).getTime() + shiftMs).toISOString();
  } else {
    return NextResponse.json(err("Either shift_mins or explicit new_start/new_end is required", "VALIDATION_ERROR"), { status: 400 });
  }

  const orderItem = booking.order_item as { id: string; table_id: string } | null;
  if (!orderItem) {
    return NextResponse.json(err("Order item missing from booking", "INVALID_STATE"), { status: 400 });
  }

  // 1. Conflict Check (overlaps with other active bookings/sessions on the same table)
  const tableId = orderItem.table_id;
  const [{ data: existingItems }, { data: existingBookings }] = await Promise.all([
    admin
      .from("order_items")
      .select("id, status, actual_start, expected_end, scheduled_start, scheduled_end")
      .eq("table_id", tableId)
      .eq("is_deleted", false)
      .in("status", ["running", "scheduled"])
      .neq("id", orderItem.id),
    admin
      .from("bookings")
      .select("id, status, scheduled_start, scheduled_end, order_item:order_items!inner(id, table_id)")
      .eq("status", "confirmed")
      .eq("order_items.table_id", tableId)
      .neq("id", bookingId),
  ]);

  const overlaps = (aS: string, aE: string, bS: string, bE: string) =>
    new Date(aS).getTime() < new Date(bE).getTime() &&
    new Date(aE).getTime() > new Date(bS).getTime();

  let isConflict = false;
  for (const ex of (existingItems ?? [])) {
    const exS = ex.status === "running" ? ex.actual_start : ex.scheduled_start;
    const exE = ex.status === "running" ? ex.expected_end : ex.scheduled_end;
    if (exS && exE && overlaps(finalStart, finalEnd, exS, exE)) {
      isConflict = true;
      break;
    }
  }

  if (!isConflict) {
    for (const b of (existingBookings ?? [])) {
      if (!b.scheduled_start || !b.scheduled_end) continue;
      if (overlaps(finalStart, finalEnd, b.scheduled_start, b.scheduled_end)) {
        isConflict = true;
        break;
      }
    }
  }

  if (isConflict) {
    return NextResponse.json(
      err("The proposed timeslot conflicts with an existing booking on this table.", "SLOT_CONFLICT"),
      { status: 409 }
    );
  }

  // 2. Perform reschedule updates
  const [{ error: bookingErr }] = await Promise.all([
    admin.from("bookings").update({ scheduled_start: finalStart, scheduled_end: finalEnd }).eq("id", bookingId),
    admin.from("order_items").update({ scheduled_start: finalStart, scheduled_end: finalEnd }).eq("id", orderItem.id),
  ]);

  if (bookingErr) return NextResponse.json(err(bookingErr.message, "DB_ERROR"), { status: 500 });

  // 3. Trigger WhatsApp notification with new slot details
  if (booking.order_id) {
    const { sendWhatsAppConfirmation } = await import("@/lib/whatsapp");
    await sendWhatsAppConfirmation(booking.order_id).catch((e) => {
      console.error("[WhatsApp] Failed to send rescheduled booking confirmation:", e);
    });
  }

  return NextResponse.json(ok({ new_start: finalStart, new_end: finalEnd }));
}
