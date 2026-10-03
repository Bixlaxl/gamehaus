export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OwnerAccountsContent } from "./content";
import { getOperatingDate } from "@/lib/utils";

export default async function OwnerAccountsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("id, name, role")
    .eq("id", session.user.id)
    .single();

  if (profile?.role !== "owner") {
    redirect("/pos");
  }

  const { data: locations } = await admin
    .from("locations")
    .select("id, name, opening_time, closing_time")
    .eq("is_active", true)
    .order("name");

  const defaultLocation = locations?.[0];
  const defaultDate = getOperatingDate(new Date(), defaultLocation?.opening_time ?? "10:00");

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
      <OwnerAccountsContent
        locations={locations ?? []}
        initialDate={defaultDate}
        userName={profile?.name ?? "Owner"}
        userRole="owner"
      />
    </main>
  );
}
