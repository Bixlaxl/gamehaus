export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingsContent } from "@/app/(owner)/owner/bookings/content";

/**
 * Staff bookings page — reuses the owner BookingsContent component verbatim
 * so the two surfaces stay visually identical. Differences vs owner:
 *   - mode="staff" injects Check-in / No-show buttons on each confirmed row
 *   - those buttons are gated by the staff's location operating hours
 *   - the API is auto-scoped to the staff's location (see /api/owner/bookings)
 */
export default async function StaffBookingsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select(`
      role, name, location_id,
      location:locations(id, name, opening_time, closing_time)
    `)
    .eq("id", session.user.id)
    .single();
  if (!profile?.location_id || !profile.location) redirect("/pos");

  const location = profile.location as any;
  const admin = createAdminClient();

  const opening = location?.opening_time ?? "10:00:00";
  const closing = location?.closing_time ?? "23:00:00";
  const normOpen = opening.length === 5 ? `${opening}:00` : opening;
  const normClose = closing.length === 5 ? `${closing}:00` : closing;

  // Calculate active operational date in IST (shifts to yesterday if currently before 06:00 AM)
  const nowIST = new Date();
  const istFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = istFormatter.formatToParts(nowIST);
  const pMap: Record<string, string> = {};
  parts.forEach(p => pMap[p.type] = p.value);
  const hour = parseInt(pMap.hour || "0", 10);
  const dObj = new Date(Date.UTC(parseInt(pMap.year, 10), parseInt(pMap.month, 10) - 1, parseInt(pMap.day, 10), 12, 0, 0));
  if (hour < 6) {
    dObj.setUTCDate(dObj.getUTCDate() - 1);
  }
  const todayDate = dObj.toISOString().split("T")[0];

  // Operational day window: from 06:00 IST on date to 05:59:59 IST next morning (covers all venue shifts seamlessly)
  const from = new Date(`${todayDate}T06:00:00+05:30`).toISOString();
  const nextDateObj = new Date(todayDate + "T12:00:00Z");
  nextDateObj.setUTCDate(nextDateObj.getUTCDate() + 1);
  const nextDate = nextDateObj.toISOString().split("T")[0];
  const to = new Date(`${nextDate}T05:59:59+05:30`).toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders(customer_name, customer_phone, advance_paid, type, status, location_id, subtotal, discount_amount, total_amount, points_redeemed, public_discount_amount, points_redeemed_online),
      order_item:order_items(table:tables(id, name, type, location_id, location:locations(name, id)))
    `)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  // Filter to staff's own location and remove unpaid online bookings
  const ownLocationBookings = (bookings ?? [])
    .filter((b: any) => {
      const t = b.order_item?.table;
      const locId = t?.location?.id || t?.location_id || b.order?.location_id;
      return locId === profile.location_id;
    })
    .filter((b: any) => {
      const o = b.order;
      if (o && o.type === "online" && (o.advance_paid ?? 0) === 0 && o.status === "open") {
        return false;
      }
      return true;
    });

  return (
    // BookingsContent was built for the owner light-mode panel; on the staff
    // side it lives in the dark POS shell where bg-white cards on near-white
    // surrounds disappeared. The .pos-bookings-dark class (in globals.css)
    // recolors all the inherited gray/white classes into a high-contrast
    // dark palette so cards + text + filters all stay readable.
    <main className="pos-bookings-dark flex-1 overflow-y-auto p-6">
      <div className="max-w-[1600px] mx-auto">
        <BookingsContent
          mode="staff"
          staffLocationId={profile.location_id}
          initialLocations={location ? [location] : []}
          initialBookings={ownLocationBookings}
        />
      </div>
    </main>
  );
}
