"use client";

import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Star, Boxes, Wallet, Plus, Trash2, MapPin, Users, Grid3X3, Tag, Save } from "lucide-react";
import type { AppSettings, CancellationTier } from "@/lib/settings";

type LocationRow = { id: string; name: string; slug: string; opening_time: string; closing_time: string; is_active: boolean };
type StaffRow    = { id: string; name: string; email: string; is_active: boolean; locations?: { name: string } | { name: string }[] | null };
type TableRow    = { id: string; name: string; type: string; hourly_rate: number; is_active: boolean; locations?: { name: string } | { name: string }[] | null };
type CouponRow   = { id: string; code: string; discount_type: string; discount_value: number; is_active: boolean; used_count: number; max_uses: number | null; valid_until: string | null };

interface Props {
  initialSettings: AppSettings;
  locations: LocationRow[];
  staff:     StaffRow[];
  tables:    TableRow[];
  coupons:   CouponRow[];
}

export function SettingsContent({ initialSettings, locations, staff, tables, coupons }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<AppSettings>(initialSettings);
  const [dirty, setDirty] = useState(false);

  function update<K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) {
    setDraft((d) => ({ ...d, [section]: { ...d[section], ...patch } }));
    setDirty(true);
  }
  function setTiers(which: "cancellation_full" | "cancellation_advance", tiers: CancellationTier[]) {
    setDraft((d) => ({ ...d, booking: { ...d.booking, [which]: tiers } }));
    setDirty(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(draft),
      });
      const body = await res.json() as { success: true; data: AppSettings } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    onSuccess: (data) => {
      setDraft(data);
      setDirty(false);
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-8 pb-24">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-400 mt-1 tracking-tight">Loyalty, stock alerts, booking policy + system reference</p>
        </div>
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#D4541A] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Save className="h-4 w-4" />
          {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>

      {/* ── Loyalty ─────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold text-gray-900">Loyalty Points</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Earn rate — customer spends ₹</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">₹</span>
              <NumberField
                value={draft.loyalty.earn_rupees_per_point}
                onChange={(n) => update("loyalty", { earn_rupees_per_point: n })}
                min={1}
                integer
              />
              <span className="text-sm text-gray-500 whitespace-nowrap">= 1 pt</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Redeem rate — 1 pt is worth ₹</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">1 pt =</span>
              <NumberField
                value={draft.loyalty.redeem_rupees_per_point}
                onChange={(n) => update("loyalty", { redeem_rupees_per_point: n })}
                min={0.01}
                step={0.5}
              />
              <span className="text-sm text-gray-500">₹ off</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min points to redeem</Label>
            <div className="flex items-center gap-2">
              <NumberField
                value={draft.loyalty.min_points_to_redeem}
                onChange={(n) => update("loyalty", { min_points_to_redeem: n })}
                min={0}
                integer
              />
              <span className="text-sm text-gray-500">pts</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Earned at walk-in finalize + online payment webhook. Redemption is optional and capped at the bill amount.
        </p>
      </section>

      {/* ── Stock alerts ─────────────────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Boxes className="h-4 w-4 text-emerald-600" />
          <h2 className="font-semibold text-gray-900">Stock Alerts</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Low-stock threshold</Label>
            <NumberField
              value={draft.stock.default_low_threshold}
              onChange={(n) => update("stock", { default_low_threshold: n })}
              min={0}
              integer
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Items at or below this count show an alert badge on the Inventory nav (owner + staff).
          Save changes above first, then click <b>Apply to all existing items</b> to push the new
          threshold to every catalogue item (otherwise it only affects new items going forward).
        </p>
        <ApplyDefaultThresholdButton />
      </section>

      {/* ── Booking — Reserve table block ─────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-start gap-2">
          <Wallet className="h-4 w-4 text-blue-600 mt-0.5" />
          <div>
            <h2 className="font-semibold text-gray-900">Reserve table</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Customer pays a fixed amount online to hold the slot; the rest is collected at the venue.
            </p>
          </div>
        </div>

        <div className="space-y-1.5 max-w-xs">
          <Label className="text-xs">Reserve amount per table (₹)</Label>
          <NumberField
            value={draft.booking.advance_amount_per_table}
            onChange={(n) => update("booking", { advance_amount_per_table: n })}
            min={0}
            integer
          />
        </div>

        <CancellationEditor
          title="Cancellation refund — Reserve"
          subtitle="What the customer gets back from the reserve amount if they cancel."
          tiers={draft.booking.cancellation_advance}
          onChange={(t) => setTiers("cancellation_advance", t)}
        />
      </section>

      {/* ── Booking — Full advance payment block ──────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
        <div className="flex items-start gap-2">
          <Wallet className="h-4 w-4 text-emerald-600 mt-0.5" />
          <div>
            <h2 className="font-semibold text-gray-900">Full advance payment</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Customer pays the entire booking amount online up front (no balance due at the venue).
            </p>
          </div>
        </div>

        <CancellationEditor
          title="Cancellation refund — Full payment"
          subtitle="What the customer gets back from the full amount if they cancel."
          tiers={draft.booking.cancellation_full}
          onChange={(t) => setTiers("cancellation_full", t)}
        />
      </section>

      {/* ── Reference cards ─────────────────────────────────────────────── */}
      <ReferenceSection icon={<MapPin className="h-4 w-4 text-gray-500" />} title="Locations" count={locations.length}>
        {locations.map((loc) => (
          <Row
            key={loc.id}
            primary={loc.name}
            secondary={`/${loc.slug} · ${loc.opening_time} – ${loc.closing_time}`}
            rhs={<Badge variant={loc.is_active ? "success" : "secondary"}>{loc.is_active ? "Active" : "Inactive"}</Badge>}
          />
        ))}
      </ReferenceSection>

      <ReferenceSection icon={<Users className="h-4 w-4 text-gray-500" />} title="Staff" count={staff.length}>
        {staff.map((s) => {
          const locName = Array.isArray(s.locations) ? s.locations[0]?.name : s.locations?.name;
          return (
            <Row
              key={s.id}
              primary={s.name}
              secondary={`${s.email}${locName ? ` · ${locName}` : ""}`}
              rhs={<Badge variant={s.is_active ? "success" : "secondary"}>{s.is_active ? "Active" : "Inactive"}</Badge>}
            />
          );
        })}
      </ReferenceSection>

      <ReferenceSection icon={<Grid3X3 className="h-4 w-4 text-gray-500" />} title="Tables" count={tables.length}>
        {tables.map((t) => {
          const locName = Array.isArray(t.locations) ? t.locations[0]?.name : t.locations?.name;
          return (
            <Row
              key={t.id}
              primary={t.name}
              secondary={`${t.type} · ₹${t.hourly_rate}/hr${locName ? ` · ${locName}` : ""}`}
              rhs={<Badge variant={t.is_active ? "success" : "secondary"}>{t.is_active ? "Active" : "Inactive"}</Badge>}
            />
          );
        })}
      </ReferenceSection>

      <ReferenceSection icon={<Tag className="h-4 w-4 text-gray-500" />} title="Coupons" count={coupons.length}>
        {coupons.map((c) => (
          <Row
            key={c.id}
            primary={c.code}
            secondary={`${c.discount_type === "percent" ? `${c.discount_value}%` : `₹${c.discount_value}`} off · used ${c.used_count}${c.max_uses ? `/${c.max_uses}` : ""}`}
            rhs={<Badge variant={c.is_active ? "success" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge>}
          />
        ))}
      </ReferenceSection>

      {dirty && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
          Unsaved changes — hit Save above
        </div>
      )}
    </div>
  );
}

function ApplyDefaultThresholdButton() {
  const qc = useQueryClient();
  const apply = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/inventory/apply-default-threshold", { method: "POST" });
      const body = await res.json() as { success: true; data: { updated: number; threshold: number } } | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    onSuccess: (d) => {
      if (d.updated === 0) {
        toast.success(`Already applied — every item is at ${d.threshold}.`);
      } else {
        toast.success(`Threshold ${d.threshold} applied to ${d.updated} item${d.updated === 1 ? "" : "s"}.`);
      }
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-count"] });
      qc.invalidateQueries({ queryKey: ["inventory-low-list"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <button
      onClick={() => apply.mutate()}
      disabled={apply.isPending}
      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-800 hover:bg-gray-200 transition-colors disabled:opacity-40"
    >
      {apply.isPending ? "Applying…" : "Apply to all existing items"}
    </button>
  );
}

/**
 * Numeric input that lets the user clear the field and type freely.
 * The native onChange clamping previously forced any blank to "0" or "1"
 * so deleting digits was impossible. Here we keep a raw string buffer
 * locally, only push a parsed number up when the value is actually valid,
 * and snap back to the last good value on blur if left empty.
 */
function NumberField({
  value, onChange, min, max, step, integer, className,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  className?: string;
}) {
  const [raw, setRaw] = useState<string>(String(value));
  // Keep raw in sync when external value changes (e.g. saving resets state)
  // — but only when our buffer doesn't represent the same number, so the
  // user's mid-edit string isn't clobbered.
  useEffect(() => {
    const parsed = integer ? parseInt(raw) : parseFloat(raw);
    if (Number.isFinite(parsed) && parsed === value) return;
    if (raw === "" && value === 0) return;
    setRaw(String(value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setRaw(v);
    if (v === "") return; // allow empty buffer; commit nothing yet
    const n = integer ? parseInt(v) : parseFloat(v);
    if (!Number.isFinite(n)) return;
    let clamped = n;
    if (min !== undefined && clamped < min) return; // don't auto-snap mid-edit
    if (max !== undefined && clamped > max) clamped = max;
    onChange(clamped);
  }

  function handleBlur() {
    if (raw === "") {
      // Field left empty — fall back to min (or 0). Pushes to parent + buffer.
      const fallback = min ?? 0;
      setRaw(String(fallback));
      onChange(fallback);
      return;
    }
    const n = integer ? parseInt(raw) : parseFloat(raw);
    if (!Number.isFinite(n)) {
      setRaw(String(value));
      return;
    }
    let clamped = n;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    setRaw(String(clamped));
    onChange(clamped);
  }

  return (
    <Input
      type="number"
      step={step}
      value={raw}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
    />
  );
}

function CancellationEditor({
  title, subtitle, tiers, onChange,
}: {
  title: string;
  subtitle: string;
  tiers: CancellationTier[];
  onChange: (t: CancellationTier[]) => void;
}) {
  function update(i: number, patch: Partial<CancellationTier>) {
    onChange(tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  }
  function add() {
    onChange([...tiers, { hours_before: 0, refund_pct: 0 }]);
  }
  function remove(i: number) {
    onChange(tiers.filter((_, idx) => idx !== i));
  }

  const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        {tiers.length === 0 && (
          <p className="text-xs text-gray-400 p-3">No tiers — customer gets no refund regardless of timing.</p>
        )}
        {tiers.map((t, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <span className="text-xs text-gray-500">If cancelled at least</span>
            <NumberField
              value={t.hours_before}
              onChange={(n) => update(i, { hours_before: n })}
              min={0}
              step={0.25}
              className="w-20"
            />
            <span className="text-xs text-gray-500">hr before, refund</span>
            <NumberField
              value={t.refund_pct}
              onChange={(n) => update(i, { refund_pct: n })}
              min={0}
              max={100}
              className="w-20"
            />
            <span className="text-xs text-gray-500">%</span>
            <button
              onClick={() => remove(i)}
              className="ml-auto text-gray-400 hover:text-red-500 transition-colors"
              title="Remove tier"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={add}
        className="flex items-center gap-1.5 text-xs font-bold text-[#D4541A] hover:opacity-80"
      >
        <Plus className="h-3.5 w-3.5" /> Add tier
      </button>
      {sorted.length > 0 && (
        <p className="text-[11px] text-gray-400">
          Preview: {sorted.map((t) => `${t.hours_before}h → ${t.refund_pct}%`).join(", ")}
        </p>
      )}
    </div>
  );
}

function ReferenceSection({
  icon, title, count, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <span className="ml-auto text-xs text-gray-400">{count} total</span>
      </div>
      <div className="divide-y divide-gray-50">{children}</div>
    </div>
  );
}

function Row({ primary, secondary, rhs }: { primary: string; secondary: string; rhs: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{primary}</p>
        <p className="text-xs text-gray-400 mt-0.5 truncate">{secondary}</p>
      </div>
      <div className="shrink-0">{rhs}</div>
    </div>
  );
}
