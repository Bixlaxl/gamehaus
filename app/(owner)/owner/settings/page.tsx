import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Grid3X3, Tag, Star } from "lucide-react";

export default async function SettingsPage() {
  const admin = createAdminClient();

  const [
    { data: locations },
    { data: staff },
    { data: tables },
    { data: coupons },
  ] = await Promise.all([
    admin.from("locations").select("id, name, slug, opening_time, closing_time, is_active").order("created_at"),
    admin.from("users").select("id, name, email, role, is_active, location_id, locations(name)").eq("role", "staff").order("name"),
    admin.from("tables").select("id, name, type, hourly_rate, is_active, location_id, locations(name)").order("sort_order"),
    admin.from("coupons").select("id, code, discount_type, discount_value, is_active, used_count, max_uses, valid_until").order("created_at", { ascending: false }).limit(10),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-400 mt-1">System overview and configuration reference</p>
      </div>

      {/* Loyalty system info */}
      <div className="bg-white rounded-xl border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-gray-900">Loyalty Points</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg bg-gray-50 border px-4 py-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Earn rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">₹100 <span className="text-base font-normal text-gray-500">= 1 pt</span></p>
          </div>
          <div className="rounded-lg bg-gray-50 border px-4 py-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Redeem rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">1 pt <span className="text-base font-normal text-gray-500">= ₹1</span></p>
          </div>
          <div className="rounded-lg bg-gray-50 border px-4 py-3 text-center">
            <p className="text-xs text-gray-500 font-medium">Identified by</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">Phone</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">
          Points are credited automatically — at bill finalization for walk-ins, and via Razorpay webhook for online bookings.
          Redemption is optional and partial. Staff can set any amount up to the customer&apos;s balance at finalize time.
        </p>
      </div>

      {/* Locations */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <MapPin className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Locations</h2>
          <span className="ml-auto text-xs text-gray-400">{locations?.length ?? 0} total</span>
        </div>
        <div className="divide-y">
          {locations?.map((loc) => (
            <div key={loc.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{loc.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  /{loc.slug} · {loc.opening_time} – {loc.closing_time}
                </p>
              </div>
              <Badge variant={loc.is_active ? "success" : "secondary"}>
                {loc.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Staff */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Users className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Staff Accounts</h2>
          <span className="ml-auto text-xs text-gray-400">{staff?.length ?? 0} total</span>
        </div>
        <div className="divide-y">
          {staff?.map((s) => (
            <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{s.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {s.email} · {(s.locations as { name: string } | null)?.name ?? "No location"}
                </p>
              </div>
              <Badge variant={s.is_active ? "success" : "secondary"}>
                {s.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
          ))}
          {staff?.length === 0 && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No staff accounts yet</p>
          )}
        </div>
      </div>

      {/* Tables summary */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Tables</h2>
          <span className="ml-auto text-xs text-gray-400">
            {tables?.filter((t) => t.is_active).length ?? 0} active · {tables?.length ?? 0} total
          </span>
        </div>
        <div className="divide-y">
          {tables?.map((t) => (
            <div key={t.id} className="px-5 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t.type} · {(t.locations as { name: string } | null)?.name ?? "—"} · ₹{t.hourly_rate}/hr
                </p>
              </div>
              <Badge variant={t.is_active ? "success" : "secondary"}>
                {t.is_active ? "Active" : "Inactive"}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Recent coupons */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <Tag className="h-4 w-4 text-gray-500" />
          <h2 className="font-semibold text-gray-900">Recent Coupons</h2>
          <span className="ml-auto text-xs text-gray-400">Last 10</span>
        </div>
        <div className="divide-y">
          {coupons?.map((c) => {
            const expired = new Date(c.valid_until) < new Date();
            return (
              <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-mono font-semibold text-gray-900">{c.code}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {c.discount_type === "percent" ? `${c.discount_value}%` : `₹${c.discount_value}`} off ·{" "}
                    {c.used_count}{c.max_uses !== null ? ` / ${c.max_uses}` : ""} uses ·{" "}
                    until {new Date(c.valid_until).toLocaleDateString("en-IN")}
                  </p>
                </div>
                <Badge variant={!c.is_active || expired ? "secondary" : "success"}>
                  {!c.is_active ? "Inactive" : expired ? "Expired" : "Active"}
                </Badge>
              </div>
            );
          })}
          {coupons?.length === 0 && (
            <p className="px-5 py-6 text-sm text-gray-400 text-center">No coupons yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
