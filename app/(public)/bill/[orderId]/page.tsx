import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import { ClientBillView } from "./client-bill-view";

export const runtime = "edge";
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ orderId: string }>;
}

export default async function BillPage({ params }: PageProps) {
  const { orderId } = await params;
  const admin = createAdminClient();

  const { data: order, error } = await admin
    .from("orders")
    .select(`
      *,
      locations (
        name,
        address,
        phone,
        slug,
        timezone
      ),
      items:order_items (
        id,
        scheduled_start,
        scheduled_end,
        actual_start,
        actual_end,
        rate_per_hour,
        final_amount,
        num_people,
        selected_mode_name,
        free_hours_to_redeem,
        membership_id,
        tables (
          name,
          type
        )
      ),
      extras:order_extras (
        id,
        name,
        price,
        quantity,
        is_deleted
      ),
      payments (
        id,
        amount,
        method,
        status,
        collected_at
      )
    `)
    .eq("id", orderId)
    .single();

  if (error || !order) {
    notFound();
  }

  return <ClientBillView order={order as any} />;
}
