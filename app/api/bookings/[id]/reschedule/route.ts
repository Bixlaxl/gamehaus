import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { z } from "zod";

export const runtime = 'edge';


const schema = z.object({
  shift_mins: z.number().int().min(15).max(120), // how many minutes to shift forward
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

  const { shift_mins } = parsed.data;
  const admin = createAdminClient();

  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .select("*, order_item:order_items!inner(id, table_id, scheduled_start, scheduled_end)")
    .eq("id", bookingId)
    .single();

  if (bErr || !booking) {
    return NextResponse.json(err("Booking not found", "NOT_FOUND"), { status: 404 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json(err("Can only reschedule confirmed bookings", "INVALID_STATE"), { status: 400 });
  }

  const shiftMs          = shift_mins * 60 * 1000;
  const newStart         = new Date(new Date(booking.scheduled_start).getTime() + shiftMs).toISOString();
  const newEnd           = new Date(new Date(booking.scheduled_end).getTime() + shiftMs).toISOString();

  const orderItem = booking.order_item as { id: string } | null;

  const [{ error: bookingErr }] = await Promise.all([
    admin.from("bookings").update({ scheduled_start: newStart, scheduled_end: newEnd }).eq("id", bookingId),
    orderItem?.id
      ? admin.from("order_items").update({ scheduled_start: newStart, scheduled_end: newEnd }).eq("id", orderItem.id)
      : Promise.resolve(null),
  ]);

  if (bookingErr) return NextResponse.json(err(bookingErr.message, "DB_ERROR"), { status: 500 });

  return NextResponse.json(ok({ new_start: newStart, new_end: newEnd }));
}
