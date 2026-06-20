export const runtime = 'edge';
export const revalidate = 60;

import { createAdminClient } from "@/lib/supabase/admin";
import { SplashHero } from "@/components/public/splash-hero";

export default async function HomePage() {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const [{ data: locations }, { data: coupons }] = await Promise.all([
    supabase
      .from("locations")
      .select("*")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("coupons")
      .select("*")
      .eq("is_active", true)
      .eq("is_public", true)
      .lte("valid_from", now)
      .gte("valid_until", now)
  ]);

  const activeCoupons = (coupons ?? []).filter(
    (c) => c.max_uses === null || c.used_count < c.max_uses
  );

  return <SplashHero locations={locations ?? []} coupons={activeCoupons} />;
}
