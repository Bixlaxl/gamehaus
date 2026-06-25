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
  Sun, Moon,
} from "lucide-react";
import { useTheme } from "next-themes";

const navItems = [
  { href: "/owner",              label: "Overview",    icon: Home,       exact: true },
  { href: "/owner/locations",    label: "Locations",   icon: MapPin },
  { href: "/owner/tables",       label: "Tables",      icon: Grid3X3 },
  { href: "/owner/inventory",    label: "Inventory",   icon: Package },
  { href: "/owner/staff",        label: "Staff",       icon: Users },
  { href: "/owner/bookings",     label: "Bookings",    icon: BookOpen },
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
    <aside className="w-60 shrink-0 flex flex-col h-screen bg-[#0A0A0A] border-r border-[#1A1A1A]">

      {/* Logo + alerts bell */}
      <div
        className="px-4 py-4 border-b border-[#1A1A1A]"
        style={{ ["--bell-ring" as string]: "#0A0A0A" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#D4541A]" />
          <span className="text-white font-bold text-base tracking-tight">Gamehaus</span>
          <span className="ml-1 text-[9px] font-bold uppercase tracking-widest text-[#333] bg-[#111] px-1.5 py-0.5 rounded">
            Owner
          </span>
          <div className="ml-auto">
            <StockAlertsBell variant="dark" inventoryHref="/owner/inventory" />
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
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
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "text-white"
                  : "text-[#666] hover:text-[#aaa] hover:bg-[#111]"
              )}
              style={isActive ? { background: "rgba(212,84,26,0.15)", color: "#D4541A" } : {}}
            >
              <item.icon
                className="h-4 w-4 shrink-0"
                style={isActive ? { color: "#D4541A" } : {}}
              />
              {item.label}
              {item.href === "/owner/inventory" && <LowStockNavBadge />}
            </Link>
          );
        })}
      </nav>

      {/* User + theme-toggle + Sign out */}
      <div className="shrink-0 px-3 py-4 border-t border-[#1A1A1A] space-y-1">
        {mounted && (
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold text-[#999] hover:text-white hover:bg-[#111] transition-all"
          >
            {resolvedTheme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5 shrink-0" />
                Light Mode
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5 shrink-0" />
                Dark Mode
              </>
            )}
          </button>
        )}
        <div className="flex items-center gap-3 px-3 py-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
            style={{ background: "#D4541A" }}
          >
            {initials(userName)}
          </div>
          <span className="text-sm font-medium text-[#888] truncate">{userName}</span>
        </div>
        <button
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold text-[#999] hover:text-white hover:bg-[#111] transition-all disabled:opacity-40"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
    </>
  );
}
