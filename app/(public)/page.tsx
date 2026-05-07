import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { SplashHero } from "@/components/public/splash-hero";

export default async function HomePage() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: locations } = await supabase
    .from("locations")
    .select("*")
    .eq("is_active", true)
    .order("name");

  return <SplashHero locations={locations ?? []} />;
}
