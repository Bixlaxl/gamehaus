export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POSSideRail } from "@/components/pos/side-rail";

/**
 * Shared shell for every /pos/* page (Tables, Bookings, Inventory).
 *
 * The side rail used to live inside each page, which meant clicking a tab
 * unmounted the rail and re-fetched its bell badge + ran sign-out state
 * setup again. Hoisting it here keeps the rail and its in-memory state
 * (bell dropdown, polling intervals) mounted across tab switches, so the
 * only thing React tears down is the actual content area.
 *
 * Auth + profile fetch also happens once here instead of per-page.
 */
export default async function POSLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, name, location_id")
    .eq("id", session.user.id)
    .single();

  // Profile missing or mis-configured: bounce to the dedicated /pos page
  // which has the friendly diagnostic UI. Avoids rendering the side rail
  // shell on top of an error message.
  if (!profile) return <>{children}</>;
  if (!profile.location_id) {
    if (profile.role === "owner") redirect("/owner");
    return <>{children}</>;
  }

  // Just the side rail needs locationName/staffName/locationId for badges
  // — child pages still fetch whatever else they need themselves.
  const admin = createAdminClient();
  const { data: location } = await admin
    .from("locations")
    .select("name")
    .eq("id", profile.location_id)
    .single();

  return (
    <div className="h-screen flex overflow-hidden bg-[#F7F6F3] dark:bg-[#0a0a0a] text-gray-900 dark:text-[#eee]">
      <POSSideRail
        staffName={profile.name}
        locationName={location?.name ?? ""}
      />
      {children}
    </div>
  );
}
