import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';


export const dynamic = "force-dynamic";

async function autoMarkNoShows(admin: ReturnType<typeof createAdminClient>, locationId: string) {
  try {
    const now = new Date().toISOString();
    const { data: expiredBookings } = await admin
      .from("bookings")
      .select("id, order:orders!inner(location_id)")
      .eq("status", "confirmed")
      .eq("orders.location_id", locationId)
      .lte("scheduled_end", now);

    if (expiredBookings && expiredBookings.length > 0) {
      const expiredIds = expiredBookings.map((b: any) => b.id);
      await admin
        .from("bookings")
        .update({
          status: "no_show",
          no_show_marked_at: now,
        })
        .in("id", expiredIds);
    }
  } catch (err) {
    console.error("Failed to auto-mark no-shows:", err);
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  if (!locationId) return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });

  const admin = createAdminClient();
  await autoMarkNoShows(admin, locationId);

  // IST-anchored operational day window (06:00 AM IST to 06:00 AM IST next morning)
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
  const from = new Date(`${todayDate}T06:00:00+05:30`).toISOString();
  const nextDateObj = new Date(todayDate + "T12:00:00Z");
  nextDateObj.setUTCDate(nextDateObj.getUTCDate() + 1);
  const nextDate = nextDateObj.toISOString().split("T")[0];
  const to = new Date(`${nextDate}T05:59:59+05:30`).toISOString();

  const { data, error } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders!inner(customer_name, customer_phone, location_id, advance_paid, type, status, created_by, order_items(id, status)),
      order_item:order_items!order_item_id(table_id, status, selected_mode_name)
    `)
    .eq("orders.location_id", locationId)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .in("status", ["confirmed"])
    // Sort ascending so the buildTableStatus .find() on the client picks the
    // EARLIEST upcoming booking per table — not whichever one Supabase chose
    // to return first (that's how the 7:30pm booking was eclipsing the 2:15pm one).
    .order("scheduled_start", { ascending: true });

  if (error) return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });

  type BookingRow = typeof data extends (infer T)[] | null ? T : never;
  const seenIds = new Set<string>();
  const filtered = (data ?? [])
    .filter((b: BookingRow) => {
      if (seenIds.has(b.id)) return false;
      
      const order = b.order as any;
      if (order && order.type === "online" && (order.advance_paid ?? 0) === 0 && order.status === "open" && !order.created_by) {
        return false;
      }
      
      seenIds.add(b.id);
      return true;
    })
    .map((b: BookingRow) => {
      const order = b.order as { customer_name: string; customer_phone: string | null; location_id: string; advance_paid: number } | null;
      return {
        ...b,
        order: {
          customer_name:  order?.customer_name,
          customer_phone: order?.customer_phone,
          advance_paid:   order?.advance_paid ?? 0,
        },
      };
    });

  return NextResponse.json(ok(filtered));
}
