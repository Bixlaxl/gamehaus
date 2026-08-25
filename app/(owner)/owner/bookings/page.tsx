export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { BookingsContent } from "./content";

export default async function BookingsPage() {
  const admin = createAdminClient();
  const { data: locations } = await admin
    .from("locations")
    .select("id, name, opening_time, closing_time")
    .eq("is_active", true);

  // Exact Indian local date (IST)
  const todayDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  
  // Full operational window: from 00:00 IST today to 06:00 IST tomorrow (covers all venues & midnight crossing)
  const from = new Date(`${todayDate}T00:00:00+05:30`).toISOString();
  const nextDateObj = new Date(todayDate + "T12:00:00Z");
  nextDateObj.setUTCDate(nextDateObj.getUTCDate() + 1);
  const nextDate = nextDateObj.toISOString().split("T")[0];
  const to = new Date(`${nextDate}T06:00:00+05:30`).toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders(id, customer_name, customer_phone, advance_paid, type, status, created_by, location_id, subtotal, discount_amount, total_amount, points_redeemed, public_discount_amount, points_redeemed_online),
      order_item:order_items(id, table_id, table:tables(id, name, type, location_id, location:locations(name, id)))
    `)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  const filteredBookings = (bookings ?? []).filter((b: any) => {
    if (b.status === "confirmed" || b.status === "checked_in" || b.status === "finished" || b.status === "completed" || b.status === "no_show") {
      return true;
    }
    const o = b.order;
    if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open" && !o.created_by) {
      return false;
    }
    return true;
  });

  return (
    <BookingsContent
      initialLocations={locations ?? []}
      initialBookings={filteredBookings}
    />
  );
}
