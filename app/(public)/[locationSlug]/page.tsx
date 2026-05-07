import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { LocationBrowse } from "@/components/public/location-browse";

export default async function LocationPage({
  params,
}: {
  params: Promise<{ locationSlug: string }>;
}) {
  const { locationSlug } = await params;
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

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
