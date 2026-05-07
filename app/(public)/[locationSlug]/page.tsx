import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocationBrowse } from "@/components/public/location-browse";

export const dynamic = "force-dynamic";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const { locationSlug } = await params;
  const supabase = createAdminClient();

  const { data: location } = await supabase
    .from("locations")
    .select("*")
    .eq("slug", locationSlug)
    .eq("is_active", true)
    .single();

  if (!location) notFound();

  const { data: tables } = await supabase
    .from("tables")
    .select("*")
    .eq("location_id", location.id)
    .eq("is_active", true)
    .order("sort_order");

  return <LocationBrowse location={location} tables={tables ?? []} />;
}
