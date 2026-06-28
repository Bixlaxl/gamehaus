"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import NextImage from "next/image";
import type { Table, Location, TableMode } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { Plus, Pencil, Trash2, Image as ImageIcon } from "lucide-react";

const supabase = createClient();

export type FormTableMode = {
  id: string;
  name: string;
  icon: string;
  hourly_rate: string;
  pricing_basis: "none" | "player" | "controller";
  people_pricing: Record<string, string>;
};

type TableForm = {
  location_id: string;
  name: string;
  type: string;
  size: string;
  description: string;
  hourly_rate: string;
  sort_order: string;
  image_file: File | null;
  people_pricing: Record<string, string>;
  is_multi_mode: boolean;
  modes: FormTableMode[];
};

const defaultForm: TableForm = {
  location_id: "",
  name: "",
  type: "snooker",
  size: "",
  description: "",
  hourly_rate: "150",
  sort_order: "0",
  image_file: null,
  people_pricing: {},
  is_multi_mode: false,
  modes: [],
};

export function TablesContent({
  initialLocations,
  initialTables,
}: {
  initialLocations: Location[];
  initialTables: Table[];
}) {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [form, setForm] = useState<TableForm>(defaultForm);
  const [deleteConfirm, setDeleteConfirm] = useState<Table | null>(null);
  const [permanentDeleteConfirm, setPermanentDeleteConfirm] = useState<Table | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [customType, setCustomType] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customPricingBasis, setCustomPricingBasis] = useState<"none" | "player" | "controller">("none");

  const { data: locations } = useQuery({
    queryKey: ["locations", "active"],
    queryFn: async () => {
      const res = await fetch("/api/locations", { cache: "no-store" });
      const body = await res.json() as
        | { success: true;  data: typeof initialLocations }
        | { success: false; error: string };
      if (!body.success) return [];
      return body.data.filter((l) => l.is_active);
    },
    initialData: initialLocations,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: tables, isLoading } = useQuery({
    queryKey: ["tables", selectedLocation],
    queryFn: async () => {
      const url = selectedLocation === "all"
        ? "/api/tables"
        : `/api/tables?location_id=${encodeURIComponent(selectedLocation)}`;
      const res = await fetch(url, { cache: "no-store" });
      const body = await res.json() as
        | { success: true;  data: typeof initialTables }
        | { success: false; error: string };
      if (!body.success) throw new Error(body.error);
      return body.data;
    },
    initialData: selectedLocation === "all" ? initialTables : undefined,
    initialDataUpdatedAt: Date.now(),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  async function uploadImage(file: File, tableId: string, locationId: string): Promise<string> {
    const compressed = await compressImage(file, { maxWidth: 1200, quality: 0.85, format: "webp" });
    const fd = new FormData();
    fd.append("file", compressed);
    fd.append("tableId", tableId);
    fd.append("locationId", locationId);
    const res = await fetch("/api/tables/upload", { method: "POST", body: fd });
    const body = await res.json() as { success: true; data: { url: string } } | { success: false; error: string };
    if (!body.success) throw new Error(body.error);
    return body.data.url;
  }

  const upsertMutation = useMutation({
    mutationFn: async (values: TableForm & { editId?: string }) => {
      let payloadModes: TableMode[] | null = null;
      if (values.is_multi_mode && values.modes.length > 0) {
        payloadModes = values.modes.map((m) => {
          const pricingKeys = Object.keys(m.people_pricing).filter(
            (k) => m.people_pricing[k] && parseFloat(m.people_pricing[k]) > 0
          );
          const pp = pricingKeys.length > 0
            ? Object.fromEntries(pricingKeys.map((k) => [k, parseFloat(m.people_pricing[k])]))
            : null;
          return {
            id: m.id || `mode_${Math.random().toString(36).substring(2, 9)}`,
            name: m.name,
            icon: m.icon || null,
            hourly_rate: parseFloat(m.hourly_rate) || 0,
            pricing_basis: m.pricing_basis,
            people_pricing: pp,
          };
        });
      }

      const pricingKeys = Object.keys(values.people_pricing).filter(
        (k) => values.people_pricing[k] && parseFloat(values.people_pricing[k]) > 0
      );
      const peoplePricing = pricingKeys.length > 0
        ? Object.fromEntries(pricingKeys.map((k) => [k, parseFloat(values.people_pricing[k])]))
        : null;

      const primaryRate = payloadModes && payloadModes.length > 0
        ? payloadModes[0].hourly_rate
        : parseFloat(values.hourly_rate || "0");

      const payload = {
        location_id:    values.location_id,
        name:           values.name,
        type:           values.type,
        size:           values.size || undefined,
        description:    values.description || undefined,
        hourly_rate:    primaryRate,
        sort_order:     parseInt(values.sort_order || "0"),
        people_pricing: values.is_multi_mode ? null : peoplePricing,
        modes:          payloadModes,
      };

      if (values.editId) {
        const res = await fetch(`/api/tables/${values.editId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: { id: string; location_id: string } } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/tables/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      } else {
        const res = await fetch("/api/tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await res.json() as { success: true; data: { id: string; location_id: string } } | { success: false; error: string };
        if (!body.success) throw new Error(body.error);
        if (values.image_file) {
          const url = await uploadImage(values.image_file, body.data.id, body.data.location_id);
          await fetch(`/api/tables/${body.data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: url }),
          });
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["pos-tables"] });
      qc.invalidateQueries({ queryKey: ["manual-booking-tables"] });
      setDialogOpen(false);
      setEditing(null);
      setForm(defaultForm);
    },
    onError: (err) => {
      alert((err as Error).message);
    },
  });

  const softDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["pos-tables"] });
      qc.invalidateQueries({ queryKey: ["manual-booking-tables"] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["pos-tables"] });
      qc.invalidateQueries({ queryKey: ["manual-booking-tables"] });
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/tables/${id}?permanent=true`, { method: "DELETE" });
      const body = await res.json() as { success: boolean; error?: string };
      if (!body.success) throw new Error(body.error);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["tables"] });
      qc.invalidateQueries({ queryKey: ["pos-tables"] });
      qc.invalidateQueries({ queryKey: ["manual-booking-tables"] });
    },
  });

  function openAdd() {
    setEditing(null);
    setForm({ ...defaultForm, location_id: locations?.[0]?.id ?? "" });
    setCustomType("");
    setShowCustomInput(false);
    setCustomPricingBasis("none");
    setDialogOpen(true);
  }

  function openEdit(t: Table) {
    setEditing(t);
    const pp: Record<string, string> = {};
    if (t.people_pricing) {
      for (const [k, v] of Object.entries(t.people_pricing)) {
        pp[k] = String(v);
      }
    }
    const isDefault = ["snooker", "pool", "ps5", "foosball"].includes(t.type);
    const hasModes = Boolean(t.modes && Array.isArray(t.modes) && t.modes.length > 0);
    const formModes: FormTableMode[] = hasModes
      ? t.modes!.map((m) => {
          const modePp: Record<string, string> = {};
          if (m.people_pricing) {
            for (const [k, v] of Object.entries(m.people_pricing)) {
              modePp[k] = String(v);
            }
          }
          return {
            id: m.id,
            name: m.name,
            icon: m.icon ?? "",
            hourly_rate: String(m.hourly_rate),
            pricing_basis: m.pricing_basis ?? "none",
            people_pricing: modePp,
          };
        })
      : [];

    setForm({
      location_id:    t.location_id,
      name:           t.name,
      type:           t.type,
      size:           t.size ?? "",
      description:    t.description ?? "",
      hourly_rate:    String(t.hourly_rate),
      sort_order:     String(t.sort_order),
      image_file:     null,
      people_pricing: pp,
      is_multi_mode:  hasModes,
      modes:          formModes,
    });
    setCustomType(isDefault ? "" : t.type);
    setShowCustomInput(!isDefault);

    let basis: "none" | "player" | "controller" = "none";
    if (t.people_pricing && Object.keys(t.people_pricing).length > 0) {
      if (t.people_pricing["1"] !== undefined) basis = "controller";
      else basis = "player";
    }
    setCustomPricingBasis(basis);

    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const typeValue = showCustomInput ? customType.toLowerCase().trim() : form.type;

    let finalPeoplePricing = { ...form.people_pricing };
    if (showCustomInput) {
      if (customPricingBasis === "none") finalPeoplePricing = {};
      else if (customPricingBasis === "player") {
        finalPeoplePricing = {
          "4": form.people_pricing["4"] ?? "",
          "5": form.people_pricing["5"] ?? "",
          "6": form.people_pricing["6"] ?? "",
        };
      } else if (customPricingBasis === "controller") {
        finalPeoplePricing = {
          "1": form.people_pricing["1"] ?? "",
          "2": form.people_pricing["2"] ?? "",
          "3": form.people_pricing["3"] ?? "",
          "4": form.people_pricing["4"] ?? "",
        };
      }
    } else {
      if (typeValue === "snooker" || typeValue === "pool") {
        finalPeoplePricing = {
          "4": form.people_pricing["4"] ?? "",
          "5": form.people_pricing["5"] ?? "",
          "6": form.people_pricing["6"] ?? "",
        };
      } else if (typeValue === "ps5") {
        finalPeoplePricing = {
          "1": form.people_pricing["1"] ?? "",
          "2": form.people_pricing["2"] ?? "",
          "3": form.people_pricing["3"] ?? "",
          "4": form.people_pricing["4"] ?? "",
        };
      } else {
        finalPeoplePricing = {};
      }
    }

    upsertMutation.mutate({ ...form, type: typeValue, people_pricing: finalPeoplePricing, editId: editing?.id });
  }

  const typeIcon: Record<string, string> = {
    snooker: "🎱",
    pool: "🎱",
    ps5: "🎮",
    foosball: "⚽",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Tables</h1>
        <div className="flex items-center gap-3">
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All locations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations?.map((loc: Location) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={openAdd}>
            <Plus className="h-4 w-4" />
            Add Table
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables?.map((table) => {
          const loc = locations?.find((l: Location) => l.id === table.location_id);
          const hasModes = Boolean(table.modes && table.modes.length > 0);
          return (
            <div
              key={table.id}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
            >
              <div className="relative h-36 bg-gray-100 flex items-center justify-center">
                {table.image_url ? (
                  <NextImage
                    src={table.image_url}
                    alt={table.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-gray-300" />
                )}
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span>{typeIcon[table.type] ?? "🎯"}</span>
                    <h3 className="font-semibold text-gray-900">{table.name}</h3>
                  </div>
                  <Badge variant={table.is_active ? "success" : "secondary"}>
                    {table.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500">{loc?.name ?? "—"}</p>

                {hasModes ? (
                  <div className="space-y-1 pt-1 border-t">
                    <p className="text-xs font-bold text-purple-700 uppercase tracking-wide">Multi-Game Modes:</p>
                    <div className="flex flex-wrap gap-1">
                      {table.modes!.map((m) => (
                        <span key={m.id} className="text-[11px] px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 font-medium border border-purple-100 flex items-center gap-1">
                          <span>{m.icon || "🎯"}</span>
                          <span>{m.name}: ₹{m.hourly_rate}/hr</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">
                      {formatCurrency(table.hourly_rate)}/hr
                    </p>
                    {table.people_pricing && Object.keys(table.people_pricing).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {Object.entries(table.people_pricing).sort(([a], [b]) => Number(a) - Number(b)).map(([k, v]) => (
                          <span key={k} className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 font-medium">
                            {table.type === "ps5" ? `${k}ctrl` : `${k}p`} ₹{v}/hr
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}

                <div className="flex items-center gap-2 pt-2">
                  {!table.is_active && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reactivateMutation.mutate(table.id)}
                      >
                        Reactivate
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setPermanentDeleteConfirm(table)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openEdit(table)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {table.is_active && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setDeleteConfirm(table)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Table" : "Add Table"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations?.map((loc: Location) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tname">Name</Label>
                <Input
                  id="tname"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Primary Type</Label>
                <Select
                  value={showCustomInput ? "custom" : form.type}
                  onValueChange={(v) => {
                    if (v === "custom") {
                      setShowCustomInput(true);
                      setForm({ ...form, type: customType || "custom" });
                    } else {
                      setShowCustomInput(false);
                      setForm({ ...form, type: v });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="snooker">Snooker</SelectItem>
                    <SelectItem value="pool">Pool</SelectItem>
                    <SelectItem value="ps5">PS5 Console</SelectItem>
                    <SelectItem value="foosball">Foosball</SelectItem>
                    <SelectItem value="custom">Custom...</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {showCustomInput && (
              <div className="space-y-2">
                <Label htmlFor="customType">Custom Type Name</Label>
                <Input
                  id="customType"
                  value={customType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCustomType(val);
                    setForm({ ...form, type: val });
                  }}
                  placeholder="e.g. simulator"
                  required
                />
              </div>
            )}

            {/* ── Dynamic Table Modes Section ── */}
            <div className="p-3 bg-purple-50/60 border border-purple-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-bold text-purple-900">Dynamic Game Modes</Label>
                  <p className="text-[11px] text-purple-700">Enable if table has multiple game choices (e.g. PS5 + Simulator, Snooker + Pool)</p>
                </div>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-purple-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  checked={form.is_multi_mode}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    let newModes = form.modes;
                    if (checked && newModes.length === 0) {
                      newModes = [
                        { id: `m_${Math.random().toString(36).substring(2, 7)}`, name: "PS5", icon: "🎮", hourly_rate: form.hourly_rate || "200", pricing_basis: "controller", people_pricing: {} },
                        { id: `m_${Math.random().toString(36).substring(2, 7)}`, name: "Simulator", icon: "🕹️", hourly_rate: "350", pricing_basis: "none", people_pricing: {} },
                      ];
                    }
                    setForm({ ...form, is_multi_mode: checked, modes: newModes });
                  }}
                />
              </div>

              {form.is_multi_mode && (
                <div className="space-y-3 pt-2">
                  {form.modes.map((mode, idx) => (
                    <div key={mode.id || idx} className="p-3 bg-white border border-purple-100 rounded-xl space-y-2.5 shadow-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-purple-800 uppercase">Mode {idx + 1}</span>
                        {form.modes.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs text-red-500 hover:text-red-700 p-0 px-1"
                            onClick={() => {
                              setForm({ ...form, modes: form.modes.filter((_, i) => i !== idx) });
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Mode Name</Label>
                          <Input
                            placeholder="e.g. PS5 or Snooker"
                            value={mode.name}
                            onChange={(e) => {
                              const updated = [...form.modes];
                              updated[idx].name = e.target.value;
                              setForm({ ...form, modes: updated });
                            }}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Icon / Emoji</Label>
                          <Input
                            placeholder="🎮"
                            value={mode.icon}
                            onChange={(e) => {
                              const updated = [...form.modes];
                              updated[idx].icon = e.target.value;
                              setForm({ ...form, modes: updated });
                            }}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Rate (₹/hr)</Label>
                          <Input
                            type="number"
                            min="0"
                            value={mode.hourly_rate}
                            onChange={(e) => {
                              const updated = [...form.modes];
                              updated[idx].hourly_rate = e.target.value;
                              setForm({ ...form, modes: updated });
                            }}
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Pricing Basis</Label>
                          <Select
                            value={mode.pricing_basis}
                            onValueChange={(v: "none" | "player" | "controller") => {
                              const updated = [...form.modes];
                              updated[idx].pricing_basis = v;
                              setForm({ ...form, modes: updated });
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Flat Rate Only</SelectItem>
                              <SelectItem value="player">Per-Player Tiers</SelectItem>
                              <SelectItem value="controller">Per-Controller Tiers</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {mode.pricing_basis === "player" && (
                        <div className="space-y-1 pt-1">
                          <Label className="text-[11px] text-gray-500">Per-Player Rates (₹/hr)</Label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {["4", "5", "6"].map((n) => (
                              <div key={n}>
                                <p className="text-[10px] text-gray-500">{n} players</p>
                                <Input
                                  type="number"
                                  className="h-8 text-xs px-2"
                                  placeholder="₹/hr"
                                  value={mode.people_pricing[n] ?? ""}
                                  onChange={(e) => {
                                    const updated = [...form.modes];
                                    updated[idx].people_pricing = { ...updated[idx].people_pricing, [n]: e.target.value };
                                    setForm({ ...form, modes: updated });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {mode.pricing_basis === "controller" && (
                        <div className="space-y-1 pt-1">
                          <Label className="text-[11px] text-gray-500">Per-Controller Rates (₹/hr)</Label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {["1", "2", "3", "4"].map((n) => (
                              <div key={n}>
                                <p className="text-[10px] text-gray-500">{n} ctrl</p>
                                <Input
                                  type="number"
                                  className="h-8 text-xs px-2"
                                  placeholder="₹/hr"
                                  value={mode.people_pricing[n] ?? ""}
                                  onChange={(e) => {
                                    const updated = [...form.modes];
                                    updated[idx].people_pricing = { ...updated[idx].people_pricing, [n]: e.target.value };
                                    setForm({ ...form, modes: updated });
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs border-purple-200 text-purple-700 hover:bg-purple-100 bg-white"
                    onClick={() => {
                      setForm({
                        ...form,
                        modes: [
                          ...form.modes,
                          {
                            id: `m_${Math.random().toString(36).substring(2, 7)}`,
                            name: `Mode ${form.modes.length + 1}`,
                            icon: "🎮",
                            hourly_rate: "150",
                            pricing_basis: "none",
                            people_pricing: {},
                          },
                        ],
                      });
                    }}
                  >
                    + Add Game Mode
                  </Button>
                </div>
              )}
            </div>

            {/* Standard Single-Mode Pricing (hidden if multi-mode enabled) */}
            {!form.is_multi_mode && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rate">Rate (₹/hr)</Label>
                    <Input
                      id="rate"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.hourly_rate}
                      onChange={(e) =>
                        setForm({ ...form, hourly_rate: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sort">Sort Order</Label>
                    <Input
                      id="sort"
                      type="number"
                      value={form.sort_order}
                      onChange={(e) =>
                        setForm({ ...form, sort_order: e.target.value })
                      }
                    />
                  </div>
                </div>

                {(form.type === "snooker" || form.type === "pool" || (showCustomInput && customPricingBasis === "player")) && (
                  <div className="space-y-2">
                    <Label>Per-Player Hourly Rate (₹/hr) — optional</Label>
                    <p className="text-xs text-gray-400">Override flat hourly rate based on group size.</p>
                    <div className="grid grid-cols-3 gap-2">
                      {["4", "5", "6"].map((n) => (
                        <div key={n} className="space-y-1">
                          <p className="text-xs text-gray-500 font-medium">{n} players</p>
                          <Input
                            type="number"
                            min="0"
                            placeholder="₹/hr"
                            value={form.people_pricing[n] ?? ""}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                people_pricing: { ...form.people_pricing, [n]: e.target.value },
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(form.type === "ps5" || (showCustomInput && customPricingBasis === "controller")) && (
                  <div className="space-y-2">
                    <Label>Per-Controller Hourly Rate (₹/hr) — optional</Label>
                    <p className="text-xs text-gray-400">Override flat hourly rate based on controller count.</p>
                    <div className="grid grid-cols-4 gap-2">
                      {["1", "2", "3", "4"].map((n) => (
                        <div key={n} className="space-y-1">
                          <p className="text-xs text-gray-500 font-medium">{n} ctrl</p>
                          <Input
                            type="number"
                            min="0"
                            placeholder="₹/hr"
                            value={form.people_pricing[n] ?? ""}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                people_pricing: { ...form.people_pricing, [n]: e.target.value },
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="size">Size (optional)</Label>
              <Input
                id="size"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                placeholder="e.g. 6ft, 7ft"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description (optional)</Label>
              <Input
                id="desc"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="img">Table Image</Label>
              <Input
                id="img"
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setForm({ ...form, image_file: e.target.files?.[0] ?? null })
                }
              />
            </div>
            {upsertMutation.error && (
              <p className="text-sm text-destructive">
                {(upsertMutation.error as Error).message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? "Saving..." : "Save Table"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Deactivate Table?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{deleteConfirm?.name}</strong> will be marked inactive.
            Existing sessions and bookings are preserved.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                deleteConfirm && softDeleteMutation.mutate(deleteConfirm.id)
              }
              disabled={softDeleteMutation.isPending}
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent delete confirmation */}
      <Dialog open={!!permanentDeleteConfirm} onOpenChange={() => setPermanentDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Table?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600">
            <strong>{permanentDeleteConfirm?.name}</strong> will be permanently deleted and cannot be recovered. All associated data will be lost.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermanentDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => permanentDeleteConfirm && permanentDeleteMutation.mutate(permanentDeleteConfirm.id)}
              disabled={permanentDeleteMutation.isPending}
            >
              {permanentDeleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
