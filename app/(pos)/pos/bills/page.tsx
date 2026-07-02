export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BillsContent, type BillRow } from "./content";

export default async function StaffBillsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, location_id")
    .eq("id", session.user.id)
    .single();
  if (!profile?.location_id) redirect("/pos");

  const admin = createAdminClient();
  const [
    { data: location },
    { data: initial },
    { data: tables },
    { data: inventory }
  ] = await Promise.all([
    admin.from("locations").select("name").eq("id", profile.location_id).single(),
    admin
      .from("orders")
      .select(`
        id, location_id, type, customer_name, customer_phone, status,
        subtotal, discount_amount, total_amount, amount_due, advance_paid, points_redeemed,
        finalized_at, created_at,
        items:order_items(id, table_id, status, actual_start, actual_end, expected_end, rate_per_hour, final_amount, num_people, table:tables(name, type)),
        extras:order_extras(id, name, price, quantity, is_deleted),
        payments(id, amount, method, status, collected_at)
      `)
      .eq("status", "finalized")
      .eq("location_id", profile.location_id)
      .order("finalized_at", { ascending: false })
      .limit(100),
    admin
      .from("tables")
      .select("id, name, type, hourly_rate")
      .eq("location_id", profile.location_id)
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("inventory_items")
      .select("id, name, category, selling_price, stock_count")
      .eq("location_id", profile.location_id)
      .eq("is_active", true)
      .gt("stock_count", 0)
      .order("name")
  ]);

  // Filter out hollow imported historical orders (which have neither table sessions nor inventory extras)
  const filteredInitial = (initial ?? []).filter(
    (o) => (o.items && o.items.length > 0) || (o.extras && o.extras.length > 0)
  );

  return (
    <main className="pos-bookings-dark flex-1 overflow-y-auto p-6">
      <BillsContent
        locationId={profile.location_id}
        locationName={location?.name ?? ""}
        initial={filteredInitial as unknown as BillRow[]}
        tables={tables ?? []}
        inventoryItems={inventory ?? []}
      />
    </main>
  );
}
