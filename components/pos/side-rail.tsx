"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, LayoutGrid, CalendarDays } from "lucide-react";

// Inventory was removed from the staff side rail; owners still manage stock
// via /owner/inventory. Bell + low-stock badge components stay in the repo
// for the owner sidebar but are no longer rendered here.

type Route = "tables" | "bookings";

interface Props {
  /** Optional override — when omitted, the active route is derived from the URL pathname. */
  activeRoute?: Route;
  staffName?: string;
  locationName?: string;
}

const NAV: { route: Route; label: string; href: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { route: "tables",    label: "Tables",    href: "/pos",           Icon: LayoutGrid   },
  { route: "bookings",  label: "Bookings",  href: "/pos/bookings",  Icon: CalendarDays },
];

function deriveActive(pathname: string): Route {
  if (pathname.startsWith("/pos/bookings")) return "bookings";
  return "tables";
}

export function POSSideRail({ activeRoute, staffName, locationName }: Props) {
  const pathname = usePathname();
  const active   = activeRoute ?? deriveActive(pathname ?? "/pos");
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);

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

      <nav className="w-44 shrink-0 flex flex-col bg-[#161616] border-r border-[#222]">
        {/* Brand */}
        <div className="h-14 flex items-center gap-2 px-3 border-b border-[#222] shrink-0">
          <span className="flex-1 font-black text-lg tracking-tight" style={{ color: "#D4541A" }}>
            Gamehaus
          </span>
        </div>

        {/* Nav links */}
        <div className="flex-1 flex flex-col gap-1 px-2 py-3 overflow-y-auto">
          {NAV.map(({ route, label, href, Icon }) => {
            const isActive = route === active;
            return (
              <Link
                key={route}
                href={href}
                prefetch
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-[#D4541A] text-white"
                    : "text-[#bbb] hover:bg-[#1f1f1f] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </div>

        {/* Footer — identity + sign-out */}
        <div className="shrink-0 px-2 pb-3 border-t border-[#222] pt-3 space-y-1">
          {(staffName || locationName) && (
            <div className="px-3 py-2 text-[11px] leading-tight">
              {staffName && <p className="font-semibold text-[#ddd] truncate">{staffName}</p>}
              {locationName && <p className="text-[#888] truncate">{locationName}</p>}
            </div>
          )}
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-white hover:bg-[#1f1f1f] transition-colors disabled:opacity-40"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
