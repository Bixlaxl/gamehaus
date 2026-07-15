"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, LayoutGrid, CalendarDays, Receipt, Sun, Moon, CupSoda } from "lucide-react";
import { useTheme } from "next-themes";
import { StaffConsumeModal } from "./staff-consume-modal";

// Inventory was removed from the staff side rail; owners still manage stock
// via /owner/inventory. Bell + low-stock badge components stay in the repo
// for the owner sidebar but are no longer rendered here.

type Route = "tables" | "bookings" | "bills";

interface Props {
  /** Optional override — when omitted, the active route is derived from the URL pathname. */
  activeRoute?: Route;
  staffName?: string;
  locationName?: string;
}

const NAV: { route: Route; label: string; href: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { route: "tables",    label: "Tables",    href: "/pos",           Icon: LayoutGrid   },
  { route: "bookings",  label: "Bookings",  href: "/pos/bookings",  Icon: CalendarDays },
  { route: "bills",     label: "Bills",     href: "/pos/bills",     Icon: Receipt      },
];

function deriveActive(pathname: string): Route {
  if (pathname.startsWith("/pos/bookings")) return "bookings";
  if (pathname.startsWith("/pos/bills"))    return "bills";
  return "tables";
}

export function POSSideRail({ activeRoute, staffName, locationName }: Props) {
  const pathname = usePathname();
  const active   = activeRoute ?? deriveActive(pathname ?? "/pos");
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [locationId, setLocationId] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function loadProfile() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase
          .from("users")
          .select("location_id")
          .eq("id", session.user.id)
          .single();
        if (profile?.location_id) {
          setLocationId(profile.location_id);
        }
      }
    }
    loadProfile();
  }, [supabase]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    // Brief delay so the overlay is visible (matches the pattern used on POSScreen)
    await new Promise((r) => setTimeout(r, 600));
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <>
      {signingOut && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <LogOut className="h-8 w-8 text-[#D4541A] animate-pulse mb-4" />
          <p className="text-white text-base font-semibold tracking-wide">Signing out…</p>
        </div>
      )}

      <nav className="w-60 shrink-0 flex flex-col bg-white dark:bg-[#161616] border-r border-gray-200 dark:border-[#222]">
        {/* Brand */}
        <div className="h-20 flex items-center gap-3 px-5 border-b border-gray-200 dark:border-[#222] shrink-0">
          <span className="flex-1 font-black text-2xl tracking-tight" style={{ color: "#D4541A" }}>
            Gamehaus
          </span>
        </div>

        {/* Nav links */}
        <div className="flex-1 flex flex-col gap-2 px-3 py-4 overflow-y-auto">
          {NAV.map(({ route, label, href, Icon }) => {
            const isActive = route === active;
            return (
              <Link
                key={route}
                href={href}
                prefetch
                className={`flex items-center gap-4 px-4 py-3.5 rounded-xl text-xl font-bold transition-colors ${
                  isActive
                    ? "bg-[#D4541A] text-white"
                    : "text-gray-650 dark:text-[#bbb] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] hover:text-gray-905 dark:hover:text-white"
                }`}
              >
                <Icon className="h-6 w-6 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Footer — identity + theme-toggle + staff-intake + sign-out */}
        <div className="shrink-0 px-3 pb-4 border-t border-gray-200 dark:border-[#222] pt-4 space-y-2">
          {mounted && (
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-base font-semibold text-gray-600 dark:text-[#bbb] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {resolvedTheme === "dark" ? (
                <>
                  <Sun className="h-5 w-5 shrink-0" />
                  Light Mode
                </>
              ) : (
                <>
                  <Moon className="h-5 w-5 shrink-0" />
                  Dark Mode
                </>
              )}
            </button>
          )}

          {mounted && locationId && (
            <button
              onClick={() => setConsumeOpen(true)}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-base font-bold text-emerald-600 dark:text-emerald-400 hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors"
            >
              <CupSoda className="h-5 w-5 shrink-0" />
              Log Staff Drink
            </button>
          )}

          {(staffName || locationName) && (
            <div className="px-4 py-2.5 text-xs leading-tight">
              {staffName && <p className="font-semibold text-gray-700 dark:text-[#ddd] truncate">{staffName}</p>}
              {locationName && <p className="text-gray-550 dark:text-[#888] truncate">{locationName}</p>}
            </div>
          )}
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-base font-semibold text-gray-700 dark:text-white hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors disabled:opacity-40"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sign out
          </button>
        </div>
      </nav>

      {locationId && (
        <StaffConsumeModal
          isOpen={consumeOpen}
          onClose={() => setConsumeOpen(false)}
          locationId={locationId}
        />
      )}
    </>
  );
}
