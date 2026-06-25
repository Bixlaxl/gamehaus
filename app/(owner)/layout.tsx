export const runtime = 'edge';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OwnerNav } from "@/components/owner/nav";

export default async function OwnerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");
  const user = session.user;

  const { data: profile } = await supabase
    .from("users")
    .select("role, name")
    .eq("id", user.id)
    .single();

  // No profile row — show setup instructions
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-lg text-center space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Account not set up</h1>
          <p className="text-gray-600">
            Your auth account exists but has no profile row. Run this in Supabase SQL Editor:
          </p>
          <pre className="bg-gray-100 rounded-lg p-4 text-left text-sm text-gray-800 overflow-auto">
{`INSERT INTO public.users (id, name, email, role, location_id)
VALUES (
  '${user.id}',
  'Your Name',
  '${user.email ?? ""}',
  'owner',
  NULL
);`}
          </pre>
          <p className="text-gray-500 text-sm">After inserting, refresh this page.</p>
        </div>
      </div>
    );
  }

  // Staff trying to access owner panel
  if (profile.role !== "owner") redirect("/pos");

  return (
    <div className="flex h-screen overflow-hidden bg-[#F7F6F3] dark:bg-[#0a0a0a]">
      <OwnerNav userName={profile.name} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
