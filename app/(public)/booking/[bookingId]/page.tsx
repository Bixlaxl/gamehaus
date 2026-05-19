import { createAdminClient } from "@/lib/supabase/admin";
import { BookingConfirmation } from "@/components/public/booking-confirmation";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = createAdminClient();

  const { data: order } = await supabase
    .from("orders")
    .select(`
      *,
      items:order_items(
        *,
        table:tables(name, type),
        booking:bookings(*)
      )
    `)
    .eq("id", bookingId)
    .single();

  return <BookingConfirmation order={order} />;
}
