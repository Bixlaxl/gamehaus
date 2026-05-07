export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase/admin";
import { SplashHero } from "@/components/public/splash-hero";

export default async function HomePage() {
  const supabase = createAdminClient();

  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("is_active", true)
    .order("name");

  return <SplashHero locations={locations ?? []} />;
}
