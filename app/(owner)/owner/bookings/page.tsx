export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { BookingsContent } from "./content";

export default async function BookingsPage() {
  const admin = createAdminClient();
  const { data: locations } = await admin
    .from("locations")
    .select("id, name, opening_time, closing_time");

  const loc = locations?.[0];
  const opening = loc?.opening_time ?? "10:00";
  const closing = loc?.closing_time ?? "23:00";
  const todayDate = new Date().toISOString().split("T")[0];

  const [openH, openM]   = opening.split(":").map(Number);
  const [closeH, closeM] = closing.split(":").map(Number);
  const crossesMidnight  = closeH < openH || (closeH === openH && closeM < openM);
  const from = new Date(`${todayDate}T${opening}+05:30`).toISOString();
  const closeDate = crossesMidnight
    ? (() => { const d = new Date(todayDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
    : todayDate;
  const to = new Date(`${closeDate}T${closing}+05:30`).toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select(`*, order:orders(customer_name, customer_phone, advance_paid, type, status), order_item:order_items(table:tables(name, type, location:locations(name, id)))`)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  const filteredBookings = (bookings ?? []).filter((b: any) => {
    const o = b.order;
    if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open") {
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
