"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MapPin,
  Grid3X3,
  Users,
  BookOpen,
  BarChart2,
  Tag,
  Settings,
  LogOut,
  Home,
} from "lucide-react";

const navItems = [
  { href: "/owner", label: "Overview", icon: Home, exact: true },
  { href: "/owner/locations", label: "Locations", icon: MapPin },
  { href: "/owner/tables", label: "Tables", icon: Grid3X3 },
  { href: "/owner/staff", label: "Staff", icon: Users },
  { href: "/owner/bookings", label: "Bookings", icon: BookOpen },
  { href: "/owner/reports", label: "Reports", icon: BarChart2 },
  { href: "/owner/coupons", label: "Coupons", icon: Tag },
  { href: "/owner/settings", label: "Settings", icon: Settings },
];

interface OwnerNavProps {
  userName: string;
}

export function OwnerNav({ userName }: OwnerNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <span className="text-lg font-bold text-gray-900">Gamehaus</span>
            <div className="flex items-center gap-1">
              {navItems.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href) && item.href !== "/owner";
                const isOwnerRoot =
                  item.href === "/owner" && pathname === "/owner";
                const isActive = item.exact ? isOwnerRoot : active;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                      isActive
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{userName}</span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
