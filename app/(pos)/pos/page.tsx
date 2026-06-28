export const runtime = 'edge';
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import nextDynamic from "next/dynamic";
import Loading from "./loading";

const POSScreen = nextDynamic(
  () => import("@/components/pos/pos-screen").then((mod) => mod.POSScreen),
  { ssr: false, loading: () => <Loading /> }
);

export default async function POSPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");
  const user = session.user;

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, name, location_id")
    .eq("id", user.id)
    .single();

  // Profile row missing — show clear setup instruction instead of redirect loop
  if (!profile || profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">Account not set up</h1>
          <p className="text-gray-400">
            Your auth account exists but has no profile in the system. Run this
            in Supabase SQL Editor:
          </p>
          <pre className="bg-gray-800 rounded-lg p-4 text-left text-sm text-green-400 overflow-auto">
{`INSERT INTO public.users (id, name, email, role, location_id)
VALUES (
  '${user.id}',
  'Your Name',
  '${user.email}',
  'owner',   -- or 'staff'
  NULL       -- NULL for owner, location uuid for staff
);`}
          </pre>
          <p className="text-gray-400 text-sm">
            After inserting, refresh this page.
          </p>
        </div>
      </div>
    );
  }

  // Owner with no location_id → send to owner panel to manage
  if (!profile.location_id) {
    if (profile.role === "owner") redirect("/owner");
    // Staff with no location — misconfigured
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white px-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">No location assigned</h1>
          <p className="text-gray-400">
            Your staff account has no location assigned. Ask the owner to set
            your location in the Staff section.
          </p>
        </div>
      </div>
    );
  }

  const { data: location } = await supabase
    .from("locations")
    .select("name, timezone, opening_time, closing_time")
    .eq("id", profile.location_id)
    .single();

  return (
    <POSScreen
      locationId={profile.location_id}
      locationName={location?.name ?? ""}
      openingTime={location?.opening_time ?? "10:00"}
      closingTime={location?.closing_time ?? "23:00"}
      staffName={profile.name}
      userId={user.id}
    />
  );
}
