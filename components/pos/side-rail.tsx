"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LogOut,
  LayoutGrid,
  CalendarDays,
  Receipt,
  Sun,
  Moon,
  Calculator,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { useTheme } from "next-themes";
import { getOperatingDate } from "@/lib/utils";
import { getLocationOperatingHours } from "@/lib/operating-hours";

type Route = "tables" | "bookings" | "bills" | "accounts";

interface Props {
  /** Optional override — when omitted, the active route is derived from the URL pathname. */
  activeRoute?: Route;
  staffName?: string;
  locationName?: string;
  role?: string;
  locationId?: string;
  openingTime?: string;
  closingTime?: string;
  operatingHours?: any;
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

export function POSSideRail({
  activeRoute,
  staffName,
  locationName,
  role,
  locationId,
  openingTime,
  closingTime,
  operatingHours,
}: Props) {
  const pathname = usePathname();
  const active   = activeRoute ?? deriveActive(pathname ?? "/pos");
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const [showSignOutPrompt, setShowSignOutPrompt] = useState(false);
  const [shiftPending, setShiftPending] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Check shift accounts status for today's operating date
  useEffect(() => {
    if (!locationId) return;
    let isCancelled = false;

    async function checkShiftStatus() {
      try {
        const today = getOperatingDate(new Date(), openingTime ?? "10:00");
        const res = await fetch(`/api/owner/accounts?locationId=${locationId}&date=${today}`);
        const json = await res.json();
        if (!isCancelled && json.success) {
          const rec = (json.data.records || []).find((r: any) => r.business_date === today);
          setShiftPending(!rec?.night_submitted_at);
        }
      } catch {}
    }

    checkShiftStatus();
    const interval = setInterval(checkShiftStatus, 60000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [locationId, openingTime, pathname]);

  // Evaluates whether we are in the evening/night shift closing window
  function isClosingWindow(): boolean {
    const locHours = getLocationOperatingHours(
      { opening_time: openingTime, closing_time: closingTime, operating_hours: operatingHours },
      new Date()
    );
    const [ch, cm] = (locHours.closing_time || "23:30").split(":").map(Number);
    const now = new Date();
    // Convert current time to IST
    const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
    const istDate = new Date(istMs);
    const curH = istDate.getUTCHours();
    const curM = istDate.getUTCMinutes();
    const curTotal = curH * 60 + curM;

    let closeTotal = ch * 60 + cm;
    if (ch < 6) closeTotal += 24 * 60; // closes past midnight

    // Closing window: 60 minutes before closing time up to 3.5 hours post-closing
    const windowStart = closeTotal - 60;
    const windowEnd = closeTotal + 210;

    let evalCur = curTotal;
    if (curH < 6) evalCur += 24 * 60;

    return evalCur >= windowStart && evalCur <= windowEnd;
  }

  async function performSignOut() {
    setSigningOut(true);
    await new Promise((r) => setTimeout(r, 600));
    await supabase.auth.signOut();
    router.replace("/login");
  }

  function handleSignOutClick() {
    // If shift is pending during the closing window, prompt staff to enter accounts first
    if (shiftPending && isClosingWindow()) {
      setShowSignOutPrompt(true);
      return;
    }
    void performSignOut();
  }

  const showClosingAlert = shiftPending && isClosingWindow();

  return (
    <>
      {signingOut && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <LogOut className="h-8 w-8 text-[#D4541A] animate-pulse mb-4" />
          <p className="text-white text-base font-semibold tracking-wide">Signing out…</p>
        </div>
      )}

      {/* Logout Intercept Modal when shift is unsubmitted */}
      {showSignOutPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#161616] p-5 border border-gray-200 dark:border-[#262626] shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-bold text-gray-900 dark:text-white">
                Night Shift Closing Pending
              </h3>
            </div>
            <p className="text-xs text-gray-600 dark:text-[#aaa] leading-relaxed">
              Today&apos;s cash drawer count and shift accounts have not been submitted yet. Please count the drawer and enter shift accounts before leaving.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowSignOutPrompt(false);
                  void performSignOut();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#222] transition"
              >
                Sign Out Anyway
              </button>
              <button
                onClick={() => {
                  setShowSignOutPrompt(false);
                  router.push("/pos/accounts");
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-[#D4541A] hover:bg-[#b84414] transition"
              >
                Tally Shift Now
              </button>
            </div>
          </div>
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
            const isAccountsPending = route === "accounts" && showClosingAlert;

            return (
              <Link
                key={route}
                href={href}
                prefetch
                className={`flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-lg font-bold transition-colors ${
                  isActive
                    ? "bg-[#D4541A] text-white"
                    : "text-gray-650 dark:text-[#bbb] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] hover:text-gray-905 dark:hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{label}</span>
                {isAccountsPending && (
                  <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-amber-500 text-white animate-pulse">
                    Tally
                  </span>
                )}
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
            onClick={handleSignOutClick}
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
