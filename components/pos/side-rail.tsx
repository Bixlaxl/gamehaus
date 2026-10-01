"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut, LayoutGrid, CalendarDays, Receipt, Sun, Moon, Calculator, ShieldCheck } from "lucide-react";
import { useTheme } from "next-themes";

type Route = "tables" | "bookings" | "bills" | "accounts";

interface Props {
  /** Optional override — when omitted, the active route is derived from the URL pathname. */
  activeRoute?: Route;
  staffName?: string;
  locationName?: string;
  role?: string;
}

const NAV: { route: Route; label: string; href: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { route: "tables",    label: "Tables",    href: "/pos",           Icon: LayoutGrid   },
  { route: "bookings",  label: "Bookings",  href: "/pos/bookings",  Icon: CalendarDays },
  { route: "bills",     label: "Bills",     href: "/pos/bills",     Icon: Receipt      },
  { route: "accounts",  label: "Accounts",  href: "/pos/accounts",  Icon: Calculator   },
];

function deriveActive(pathname: string): Route {
  if (pathname.startsWith("/pos/bookings")) return "bookings";
  if (pathname.startsWith("/pos/bills"))    return "bills";
  if (pathname.startsWith("/pos/accounts")) return "accounts";
  return "tables";
}

export function POSSideRail({ activeRoute, staffName, locationName, role }: Props) {
  const pathname = usePathname();
  const active   = activeRoute ?? deriveActive(pathname ?? "/pos");
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
        <div className="h-20 flex items-center justify-between gap-2 px-5 border-b border-gray-200 dark:border-[#222] shrink-0">
          <span className="font-black text-2xl tracking-tight" style={{ color: "#D4541A" }}>
            Gamehaus
          </span>
          {role === "owner" && (
            <Link
              href="/owner"
              prefetch
              className="text-[11px] font-bold text-[#D4541A] bg-orange-500/10 hover:bg-orange-500/20 px-2 py-1 rounded-md transition-colors flex items-center gap-1 shrink-0"
              title="Switch to Owner Portal"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Owner
            </Link>
          )}
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

        {/* Footer — identity + theme-toggle + sign-out */}
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
    </>
  );
}
