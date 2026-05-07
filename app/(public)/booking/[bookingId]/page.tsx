import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { CheckCircle } from "lucide-react";
import Link from "next/link";

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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

  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <CheckCircle className="h-16 w-16 text-green-400 mx-auto" />
        <h1 className="text-3xl font-bold">Booking Confirmed!</h1>
        <p className="text-gray-400">
          We&apos;ll see you soon, {order?.customer_name}.
        </p>

        {order && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 text-left space-y-3">
            {(order.items as Array<{
              id: string;
              table: { name: string; type: string } | null;
              booking: Array<{ scheduled_start: string; scheduled_end: string }> | null;
            }>)?.map((item) => (
              <div key={item.id} className="border-b border-gray-800 pb-3 last:border-0 last:pb-0">
                <p className="font-medium">{item.table?.name}</p>
                {item.booking?.[0] && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    {new Date(item.booking[0].scheduled_start).toLocaleDateString(
                      "en-IN",
                      { weekday: "long", day: "numeric", month: "long" }
                    )}{" "}
                    ·{" "}
                    {new Date(item.booking[0].scheduled_start).toLocaleTimeString(
                      "en-IN",
                      { hour: "2-digit", minute: "2-digit" }
                    )}{" "}
                    –{" "}
                    {new Date(item.booking[0].scheduled_end).toLocaleTimeString(
                      "en-IN",
                      { hour: "2-digit", minute: "2-digit" }
                    )}
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-gray-500 pt-1">
              Please arrive 5 mins early. Show this page at reception.
            </p>
          </div>
        )}

        <Link
          href="/"
          className="inline-block text-blue-400 hover:text-blue-300 text-sm transition-colors"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
