export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OwnerBillsContent } from "./content";
import type { BillRow } from "@/app/(pos)/pos/bills/content";

export default async function OwnerBillsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "owner") {
    redirect("/pos");
  }

  const [{ data: locations }, { data: initial }] = await Promise.all([
    admin.from("locations").select("id, name").eq("is_active", true).order("name"),
    admin
      .from("orders")
      .select(`
        id, location_id, type, customer_name, customer_phone, status,
        subtotal, discount_amount, public_discount_amount, total_amount, amount_due, advance_paid, points_redeemed,
        finalized_at, created_at,
        items:order_items(id, table_id, status, actual_start, actual_end, expected_end, rate_per_hour, final_amount, num_people, table:tables(name, type)),
        extras:order_extras(id, name, price, quantity, is_deleted),
        payments(id, amount, method, status, collected_at)
      `)
      .eq("status", "finalized")
      .order("finalized_at", { ascending: false })
      .limit(100),
  ]);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <OwnerBillsContent
        initialLocations={locations ?? []}
        initial={(initial ?? []) as unknown as BillRow[]}
      />
    </main>
  );
}
