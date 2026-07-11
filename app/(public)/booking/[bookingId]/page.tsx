import { createAdminClient } from "@/lib/supabase/admin";
import { BookingConfirmation } from "@/components/public/booking-confirmation";

export const runtime = 'edge';
export const dynamic = "force-dynamic";

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { bookingId } = await params;
  const sp = await searchParams;
  const paymentId = typeof sp.payment_id === "string" ? sp.payment_id : undefined;

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

  return <BookingConfirmation order={order} paymentId={paymentId} />;
}
