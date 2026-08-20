"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LowStockNavBadge } from "@/components/inventory/low-stock-nav-badge";
import { StockAlertsBell } from "@/components/inventory/stock-alerts-bell";
import {
  MapPin, Grid3X3, Users, BookOpen, BarChart2,
  Tag, Settings, LogOut, Home, UserRound, Package, CreditCard,
  Sun, Moon, Receipt, Trophy
} from "lucide-react";
import { useTheme } from "next-themes";

const navItems = [
  { href: "/owner",              label: "Overview",    icon: Home,       exact: true },
  { href: "/owner/tournaments",  label: "Tournaments", icon: Trophy },
  { href: "/owner/locations",    label: "Locations",   icon: MapPin },
  { href: "/owner/tables",       label: "Tables",      icon: Grid3X3 },
  { href: "/owner/inventory",    label: "Inventory",   icon: Package },
  { href: "/owner/staff",        label: "Staff",       icon: Users },
  { href: "/owner/bookings",     label: "Bookings",    icon: BookOpen },
  { href: "/owner/bills",        label: "Bills",       icon: Receipt },
  { href: "/owner/customers",    label: "Customers",   icon: UserRound },
  { href: "/owner/memberships",  label: "Memberships", icon: CreditCard },
  { href: "/owner/coupons",      label: "Coupons",     icon: Tag },
  { href: "/owner/reports",      label: "Reports",     icon: BarChart2 },
  { href: "/owner/settings",     label: "Settings",    icon: Settings },
];

interface OwnerNavProps {
  userName: string;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function OwnerNav({ userName }: OwnerNavProps) {
  const pathname   = usePathname();
  const router     = useRouter();
  const supabase   = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Track first render to skip the initial refresh (server data is already fresh on mount)
  const hasMountedRef   = useRef(false);
  // Throttle refresh calls so rapid path changes or tab focus events don't spam.
  const lastRefreshRef  = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await new Promise((r) => setTimeout(r, 700));
    await supabase.auth.signOut();
    router.replace("/login");
  }

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (window.confirm("Sign out and leave the owner panel?")) handleSignOut();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefetch every owner route after login — makes sidebar nav feel instant
  // (router.prefetch pulls down both JS chunks and the RSC payload so loading.tsx never flashes)
  useEffect(() => {
    for (const item of navItems) {
      if (item.href !== pathname) router.prefetch(item.href);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Bust the Next.js router cache on every owner-route visit ──────────────
  // Without this, returning to /owner/bookings (or any other page) after
  // changes elsewhere (POS, customer side, another staff member) shows the
  // stale RSC payload from the previous visit. Refreshing here re-runs the
  // server component so client TanStack-Query queries get fresh initialData.
  useEffect(() => {
    // Skip the very first mount — server already rendered fresh data
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      lastRefreshRef.current = Date.now();
      return;
    }
    router.refresh();
    lastRefreshRef.current = Date.now();
  }, [pathname, router]);

  // Also refresh whenever the user comes back to the tab — covers the
  // "left this tab open, went to POS in another tab, came back" case.
  // Throttled to at most one refresh per 5s so rapid alt-tabbing doesn't
  // spam the server / re-render the world.
  useEffect(() => {
    const MIN_REFRESH_INTERVAL_MS = 5000;
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRefreshRef.current < MIN_REFRESH_INTERVAL_MS) return;
      router.refresh();
      lastRefreshRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [router]);

  return (
    <>
      {signingOut && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
          <LogOut className="h-8 w-8 text-[#D4541A] animate-pulse mb-4" />
          <p className="text-white text-base font-semibold tracking-wide">Signing out…</p>
        </div>
      )}

      <aside className="hidden lg:flex w-80 shrink-0 flex-col h-screen bg-white dark:bg-[#0A0A0A] border-r border-gray-200 dark:border-[#1A1A1A]">
        {/* Logo + alerts bell */}
        <div
          className="px-6 py-6 border-b border-gray-200 dark:border-[#1A1A1A]"
          style={{ ["--bell-ring" as string]: resolvedTheme === "dark" ? "#0A0A0A" : "#fff" } as React.CSSProperties}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full bg-[#D4541A]" />
            <span className="text-gray-900 dark:text-white font-black text-2xl tracking-tight">Gamehaus</span>
            <span className="ml-1.5 text-xs font-black uppercase tracking-widest text-gray-500 dark:text-[#333] bg-gray-100 dark:bg-[#111] px-2.5 py-1 rounded">
              Owner
            </span>
            <div className="ml-auto">
              <StockAlertsBell variant={resolvedTheme === "dark" ? "dark" : "light"} inventoryHref="/owner/inventory" />
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-1.5">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onMouseEnter={() => router.prefetch(item.href)}
                onTouchStart={() => router.prefetch(item.href)}
                className={cn(
                  "flex items-center gap-4 px-4 py-3 rounded-xl text-xl font-bold transition-all",
                  isActive
                    ? "text-white"
                    : "text-gray-655 dark:text-[#888] hover:text-gray-950 dark:hover:text-[#ccc] hover:bg-gray-50 dark:hover:bg-[#111]"
                )}
                style={isActive ? { background: "rgba(212,84,26,0.15)", color: "#D4541A" } : {}}
              >
                <item.icon
                  className="h-6 w-6 shrink-0"
                  style={isActive ? { color: "#D4541A" } : {}}
                />
                {item.label}
                {item.href === "/owner/inventory" && <LowStockNavBadge variant={resolvedTheme === "dark" ? "dark" : "light"} />}
              </Link>
            );
          })}
        </nav>

        {/* User + theme-toggle + Sign out */}
        <div className="shrink-0 px-4 py-5 border-t border-gray-200 dark:border-[#1A1A1A] space-y-2">
          {mounted && (
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-base font-semibold text-gray-500 dark:text-[#999] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#111] transition-all"
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
          <div className="flex items-center gap-4 px-4 py-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
              style={{ background: "#D4541A" }}
            >
              {initials(userName)}
            </div>
            <span className="text-base font-semibold text-gray-700 dark:text-[#888] truncate">{userName}</span>
          </div>
          <button
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-base font-semibold text-gray-500 dark:text-[#999] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#111] transition-all disabled:opacity-40"
          >
            <LogOut className="h-5 w-5 shrink-0" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
