import { createAdminClient } from "../lib/supabase/admin";

async function test() {
  const admin = createAdminClient();
  const { data: orders, error } = await admin
    .from("orders")
    .select(`
      id,
      location_id,
      location:locations(id, name)
    `)
    .limit(5);

  if (error) {
    console.error("Error fetching orders:", error);
    return;
  }

  console.log("Orders retrieved:", JSON.stringify(orders, null, 2));
}

test();
