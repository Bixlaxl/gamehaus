import { createClient } from "@/lib/supabase/server";

export default async function OwnerDashboard() {
  const supabase = await createClient();

  const [{ data: locations }, { data: tables }, { data: orders }] =
    await Promise.all([
      supabase.from("locations").select("*").eq("is_active", true),
      supabase.from("tables").select("*").eq("is_active", true),
      supabase
        .from("orders")
        .select("*")
        .eq("status", "open")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Overview</h1>
        <p className="text-gray-500 mt-1">Welcome back to Gamehaus</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg border p-6">
          <p className="text-sm text-gray-500">Active Locations</p>
          <p className="text-3xl font-bold mt-1">{locations?.length ?? 0}</p>
        </div>
        <div className="bg-white rounded-lg border p-6">
          <p className="text-sm text-gray-500">Active Tables</p>
          <p className="text-3xl font-bold mt-1">{tables?.length ?? 0}</p>
        </div>
        <div className="bg-white rounded-lg border p-6">
          <p className="text-sm text-gray-500">Open Orders (24h)</p>
          <p className="text-3xl font-bold mt-1">{orders?.length ?? 0}</p>
        </div>
      </div>
    </div>
  );
}
