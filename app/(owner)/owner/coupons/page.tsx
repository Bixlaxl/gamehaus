"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
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
import type { Coupon, Location } from "@/lib/supabase/types";
import { formatCurrency } from "@/lib/utils";
import { Plus } from "lucide-react";

const supabase = createClient();

type CouponForm = {
  location_id: string;
  code: string;
  discount_type: "percent" | "flat";
  discount_value: string;
  valid_from: string;
  valid_until: string;
  max_uses: string;
};

const defaultForm: CouponForm = {
  location_id: "all",
  code: "",
  discount_type: "percent",
  discount_value: "",
  valid_from: new Date().toISOString().split("T")[0],
  valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  max_uses: "",
};

export default function CouponsPage() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CouponForm>(defaultForm);
  const [error, setError] = useState<string | null>(null);

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("*").eq("is_active", true);
      return (data ?? []) as Location[];
    },
  });

  const { data: coupons, isLoading } = useQuery({
    queryKey: ["coupons"],
    queryFn: async () => {
      const { data } = await supabase
        .from("coupons")
        .select("*, location:locations(name)")
        .order("created_at", { ascending: false });
      return (data ?? []) as (Coupon & { location: { name: string } | null })[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: CouponForm) => {
      const { error: dbError } = await supabase.from("coupons").insert({
        location_id: values.location_id === "all" ? null : values.location_id,
        code: values.code.toUpperCase(),
        discount_type: values.discount_type,
        discount_value: parseFloat(values.discount_value),
        valid_from: new Date(values.valid_from).toISOString(),
        valid_until: new Date(values.valid_until + "T23:59:59Z").toISOString(),
        max_uses: values.max_uses ? parseInt(values.max_uses) : null,
      });
      if (dbError) throw new Error(dbError.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coupons"] });
      setDialogOpen(false);
      setForm(defaultForm);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  type CouponRow = Coupon & { location: { name: string } | null };

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("coupons").update({ is_active: false }).eq("id", id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["coupons"] });
      const prev = qc.getQueryData<CouponRow[]>(["coupons"]);
      qc.setQueryData<CouponRow[]>(["coupons"], (old) =>
        (old ?? []).map((c) => c.id === id ? { ...c, is_active: false } : c)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["coupons"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("coupons").update({ is_active: true }).eq("id", id);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["coupons"] });
      const prev = qc.getQueryData<CouponRow[]>(["coupons"]);
      qc.setQueryData<CouponRow[]>(["coupons"], (old) =>
        (old ?? []).map((c) => c.id === id ? { ...c, is_active: true } : c)
      );
      return { prev };
    },
    onError: (_, __, ctx) => {
      if (ctx?.prev) qc.setQueryData(["coupons"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["coupons"] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createMutation.mutate(form);
  }

  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Coupons</h1>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          New Coupon
        </Button>
      </div>

      <p className="text-sm text-gray-500">
        Coupons only apply to full prepay online bookings — not walk-ins.
      </p>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Discount</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Valid Until</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Uses</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {coupons?.map((coupon) => {
              const expired = new Date(coupon.valid_until) < now;
              const exhausted =
                coupon.max_uses !== null &&
                coupon.used_count >= coupon.max_uses;
              return (
                <tr key={coupon.id}>
                  <td className="px-4 py-3 font-mono font-semibold text-gray-900">
                    {coupon.code}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {coupon.discount_type === "percent"
                      ? `${coupon.discount_value}%`
                      : formatCurrency(coupon.discount_value)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {coupon.location?.name ?? "All locations"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(coupon.valid_until).toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {coupon.used_count}
                    {coupon.max_uses !== null && ` / ${coupon.max_uses}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        !coupon.is_active || expired || exhausted
                          ? "secondary"
                          : "success"
                      }
                    >
                      {!coupon.is_active
                        ? "Inactive"
                        : expired
                        ? "Expired"
                        : exhausted
                        ? "Exhausted"
                        : "Active"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {coupon.is_active ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => deactivateMutation.mutate(coupon.id)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => reactivateMutation.mutate(coupon.id)}
                      >
                        Activate
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {coupons?.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  No coupons yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Coupon</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                placeholder="SUMMER20"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.discount_type}
                  onValueChange={(v) =>
                    setForm({ ...form, discount_type: v as "percent" | "flat" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent (%)</SelectItem>
                    <SelectItem value="flat">Flat (₹)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input
                  type="number"
                  value={form.discount_value}
                  onChange={(e) =>
                    setForm({ ...form, discount_value: e.target.value })
                  }
                  required
                  min="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location scope</Label>
              <Select
                value={form.location_id}
                onValueChange={(v) => setForm({ ...form, location_id: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  {locations?.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valid from</Label>
                <Input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) =>
                    setForm({ ...form, valid_from: e.target.value })
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Valid until</Label>
                <Input
                  type="date"
                  value={form.valid_until}
                  onChange={(e) =>
                    setForm({ ...form, valid_until: e.target.value })
                  }
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max uses (leave blank for unlimited)</Label>
              <Input
                type="number"
                value={form.max_uses}
                onChange={(e) =>
                  setForm({ ...form, max_uses: e.target.value })
                }
                min="1"
                placeholder="Unlimited"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
