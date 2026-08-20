"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut, Sun, Moon, Home, MapPin, Grid3X3, Package, Users, BookOpen, Receipt, UserRound, CreditCard, Tag, BarChart2, Settings, Trophy } from "lucide-react";
import { useTheme } from "next-themes";
import { StockAlertsBell } from "@/components/inventory/stock-alerts-bell";
import { LowStockNavBadge } from "@/components/inventory/low-stock-nav-badge";
import { OwnerNav } from "./nav";

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

interface Props {
  userName: string;
  children: React.ReactNode;
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

export function OwnerLayoutShell({ userName, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
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

      <div className="flex h-screen overflow-hidden bg-[#F7F6F3] dark:bg-[#0a0a0a]">
        {/* Desktop Sidebar navigation */}
        <div className="hidden lg:flex h-full">
          <OwnerNav userName={userName} />
        </div>

        {/* Mobile Navigation Drawer overlay */}
        {mounted && mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="fixed top-0 left-0 bottom-0 z-50 w-72 bg-white dark:bg-[#0A0A0A] border-r border-gray-200 dark:border-[#1A1A1A] lg:hidden flex flex-col">
              {/* Drawer Header */}
              <div className="px-6 py-6 border-b border-gray-200 dark:border-[#1A1A1A] flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#D4541A]" />
                  <span className="text-gray-900 dark:text-white font-black text-xl tracking-tight">Gamehaus</span>
                  <span className="text-xs font-black uppercase tracking-widest text-gray-500 bg-gray-100 dark:bg-[#111] px-2 py-0.5 rounded">
                    Owner
                  </span>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-[#111] transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer Nav links */}
              <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-1">
                {navItems.map((item) => {
                  const isActive = item.exact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-4 px-4 py-3 rounded-xl text-lg font-bold transition-all",
                        isActive
                          ? "text-white"
                          : "text-gray-655 dark:text-[#888] hover:text-gray-950 dark:hover:text-[#ccc] hover:bg-gray-50 dark:hover:bg-[#111]"
                      )}
                      style={isActive ? { background: "rgba(212,84,26,0.15)", color: "#D4541A" } : {}}
                    >
                      <item.icon
                        className="h-5 w-5 shrink-0"
                        style={isActive ? { color: "#D4541A" } : {}}
                      />
                      {item.label}
                      {item.href === "/owner/inventory" && <LowStockNavBadge variant={resolvedTheme === "dark" ? "dark" : "light"} />}
                    </Link>
                  );
                })}
              </nav>

              {/* Drawer Footer controls */}
              <div className="shrink-0 px-4 py-5 border-t border-gray-200 dark:border-[#1A1A1A] space-y-2">
                <button
                  onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  className="w-full flex items-center gap-4 px-4 py-3 rounded-xl text-sm font-semibold text-gray-500 dark:text-[#999] hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#111] transition-all"
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
                <div className="flex items-center gap-4 px-4 py-3 border-t border-gray-100 dark:border-[#1a1a1a]/50 mt-1">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ background: "#D4541A" }}
                  >
                    {initials(userName)}
                  </div>
                  <span className="text-sm font-semibold text-gray-700 dark:text-[#888] truncate">{userName}</span>
                </div>
                <button
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className="w-full flex items-center gap-4 px-4 py-2 rounded-xl text-sm font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white transition-all"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden h-full">
          {/* Mobile Top Header (hidden on desktop) */}
          <header className="lg:hidden shrink-0 h-16 bg-white dark:bg-[#0A0A0A] border-b border-gray-200 dark:border-[#1A1A1A] px-4 flex items-center justify-between z-30 shadow-sm">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#111] rounded-xl transition-all"
            >
              <Menu className="h-6 w-6" />
            </button>
            <span className="font-black text-xl text-gray-900 dark:text-white">Gamehaus Owner</span>
            <div className="w-10 h-10 flex items-center justify-center">
              {mounted && (
                <StockAlertsBell variant={resolvedTheme === "dark" ? "dark" : "light"} inventoryHref="/owner/inventory" />
              )}
            </div>
          </header>

          {/* Page content scroll area */}
          <main className="flex-1 overflow-y-auto">
            <div className="max-w-[1600px] mx-auto px-4 py-6 md:px-8 md:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
