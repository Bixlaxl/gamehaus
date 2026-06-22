import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings, computeRefund } from "@/lib/settings";
import { ClientCancelPage } from "./client-cancel";
import Link from "next/link";

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export default async function CancelBookingPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  
  // Clean orderId from any URL-encoded or raw "{{1}}" template placeholders
  let cleanOrderId = decodeURIComponent(orderId).replace("{{1}}", "").trim();

  const admin = createAdminClient();

  // 1. Fetch Order and Location details
  const { data: order } = await admin
    .from("orders")
    .select(`
      id,
      status,
      advance_paid,
      discount_amount,
      points_redeemed,
      customer_name,
      customer_phone,
      location_id,
      created_at,
      locations (
        id,
        name,
        slug,
        timezone
      )
    `)
    .eq("id", cleanOrderId)
    .single();

  const locationInfo = order?.locations as unknown as { id: string; name: string; slug: string; timezone: string } | null;

  // Validate that order exists and is open
  if (!order || order.status !== "open") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5F2] dark:bg-[#0A0A0A] p-4 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-5xl">🔍</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Booking Not Eligible for Cancellation</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This booking could not be found, has already been finalized/cancelled, or is not eligible for cancellation.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-block px-6 py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98]"
              style={{ background: "#D4541A" }}
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 2. Fetch active order items
  const { data: items } = await admin
    .from("order_items")
    .select(`
      id,
      scheduled_start,
      scheduled_end,
      rate_per_hour,
      tables (
        name,
        type
      )
    `)
    .eq("order_id", cleanOrderId)
    .eq("is_deleted", false);

  const scheduledStarts = (items ?? [])
    .map((i) => i.scheduled_start)
    .filter(Boolean)
    .map((s) => new Date(s!).getTime());

  if (!items || items.length === 0 || scheduledStarts.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5F2] dark:bg-[#0A0A0A] p-4">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-5xl">⚠️</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">No Booking Slots Found</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            This order does not contain any active scheduled bookings.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-block px-6 py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98]"
              style={{ background: "#D4541A" }}
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const earliestStartMs = Math.min(...scheduledStarts);
  const nowMs = Date.now();

  // If the booking has already started
  if (nowMs >= earliestStartMs) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F5F2] dark:bg-[#0A0A0A] p-4">
        <div className="text-center space-y-4 max-w-sm">
          <p className="text-5xl">⏰</p>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Play Session Started</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Your booking has already started or passed, and cannot be cancelled online. Please contact the venue directly.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-block px-6 py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98]"
              style={{ background: "#D4541A" }}
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 3. Compute refund details
  const settings = await getAppSettings(admin);

  // Calculate total cost of order items
  const totalCost = items.reduce((sum, item) => {
    const start = new Date(item.scheduled_start!);
    const end = new Date(item.scheduled_end!);
    const hrs = (end.getTime() - start.getTime()) / (3600 * 1000);
    const itemRate = Number(item.rate_per_hour) || 0;
    return sum + (itemRate * hrs);
  }, 0);

  const roundedTotalCost = Math.round(totalCost);
  const amountPaidVal = Number(order.advance_paid) || 0;
  const discountVal = Number(order.discount_amount) || 0;
  const pointsRedeemed = Number(order.points_redeemed) || 0;
  const pointsDiscountVal = pointsRedeemed * (settings.loyalty.redeem_rupees_per_point || 0);
  const totalDiscountVal = discountVal + pointsDiscountVal;
  const netCost = Math.max(0, roundedTotalCost - totalDiscountVal);
  const isFullyPaid = amountPaidVal >= netCost - 1;

  const policyTiers = isFullyPaid
    ? settings.booking.cancellation_full
    : settings.booking.cancellation_advance;

  const { refundAmount, matchedTier } = computeRefund(
    policyTiers,
    nowMs,
    earliestStartMs,
    amountPaidVal
  );

  const refundPct = matchedTier ? matchedTier.refund_pct : 0;
  const timezone = locationInfo?.timezone || "Asia/Kolkata";

  const formattedItems = items.map((item) => {
    const tableInfo = item.tables as unknown as { name: string; type: string } | null;
    return {
      id: item.id,
      tableName: tableInfo?.name || "Table",
      tableType: tableInfo?.type || "snooker",
      scheduledStart: item.scheduled_start!,
      scheduledEnd: item.scheduled_end!,
    };
  });

  return (
    <ClientCancelPage
      orderId={cleanOrderId}
      locationName={locationInfo?.name || "Gamehaus"}
      customerName={order.customer_name || "Valued Customer"}
      advancePaid={amountPaidVal}
      earliestStartMs={earliestStartMs}
      refundPct={refundPct}
      refundAmount={refundAmount}
      items={formattedItems}
      timezone={timezone}
    />
  );
}
