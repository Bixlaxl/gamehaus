"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CupSoda, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  selling_price: number;
  stock_count: number;
  is_active: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  locationId: string;
}

export function StaffConsumeModal({ isOpen, onClose, locationId }: Props) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Load active inventory items for this location
  const { data: items = [], isLoading } = useQuery<InventoryItem[]>({
    queryKey: ["inventory", locationId],
    queryFn: async () => {
      const res = await fetch(`/api/inventory?location_id=${locationId}`);
      if (!res.ok) throw new Error("Failed to load inventory");
      const body = await res.json() as { success: boolean; data: InventoryItem[] };
      if (!body.success) throw new Error("Failed to load inventory");
      // Show all active items with positive stock (so they can choose)
      return body.data.filter((i) => i.is_active);
    },
    enabled: isOpen && !!locationId,
    staleTime: 5 * 60 * 1000,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId) {
      toast.error("Please select an item");
      return;
    }
    if (quantity < 1) {
      toast.error("Quantity must be at least 1");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/inventory/staff-consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: itemId, quantity }),
      });
      const body = await res.json() as { success: true; data: any } | { success: false; error: string };

      if (body.success) {
        const chosenItem = items.find((i) => i.id === itemId);
        toast.success(`Logged consumption: ${quantity}x ${chosenItem?.name ?? "Item"}`);
        // Refresh local cache
        queryClient.invalidateQueries({ queryKey: ["inventory", locationId] });
        queryClient.invalidateQueries({ queryKey: ["low-stock-count", locationId] });
        queryClient.invalidateQueries({ queryKey: ["low-stock-list", locationId] });
        onClose();
        setItemId("");
        setQuantity(1);
      } else {
        toast.error(body.error || "Failed to log consumption");
      }
    } catch (err: any) {
      toast.error(err?.message || "An unexpected error occurred");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedItem = items.find((i) => i.id === itemId);

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="max-w-2xl p-10 overflow-hidden bg-white dark:bg-[#111] border dark:border-[#222] rounded-3xl shadow-2xl">
        <DialogHeader className="pb-6 border-b dark:border-[#222] flex flex-row items-center gap-5">
          <div className="p-4 rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CupSoda className="h-10 w-10" />
          </div>
          <div className="min-w-0">
            <DialogTitle className="text-3xl font-black text-gray-900 dark:text-white">
              Log Staff Consumption
            </DialogTitle>
            <p className="text-base font-semibold text-gray-550 dark:text-gray-400 mt-1">
              Personal staff intake. Will adjust stock level.
            </p>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-8 pt-6">
          {/* Select Item */}
          <div className="space-y-3">
            <Label className="text-lg font-black text-gray-700 dark:text-gray-300">
              Select Item
            </Label>
            {isLoading ? (
              <div className="h-16 w-full bg-gray-50 dark:bg-[#1a1a1a] rounded-2xl flex items-center justify-center border dark:border-gray-800">
                <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
              </div>
            ) : (
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger className="h-16 text-xl font-bold rounded-2xl bg-white dark:bg-[#181818] border dark:border-[#222] px-5">
                  <SelectValue placeholder="Choose a beverage or snack..." />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#111] border dark:border-[#222]">
                  {items.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">No active catalog items</div>
                  ) : (
                    items.map((i) => (
                      <SelectItem key={i.id} value={i.id} className="text-lg font-bold p-3 hover:bg-gray-100 dark:hover:bg-[#222]">
                        {i.name} (Stock: {i.stock_count})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Quantity */}
          <div className="space-y-3">
            <Label className="text-lg font-black text-gray-700 dark:text-gray-300">
              Quantity
            </Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              placeholder="1"
              className="h-16 text-xl font-bold rounded-2xl bg-white dark:bg-[#181818] border dark:border-[#222] px-5"
            />
          </div>

          {/* Current Stock Preview */}
          {selectedItem && (
            <div className="p-5 bg-gray-50 dark:bg-[#161616] rounded-2xl text-base space-y-2 text-gray-600 dark:text-[#aaa] border dark:border-[#222] font-bold">
              <div className="flex justify-between">
                <span>Current Stock:</span>
                <span className="font-extrabold text-gray-800 dark:text-white">{selectedItem.stock_count}</span>
              </div>
              <div className="flex justify-between">
                <span>Post-Intake Stock:</span>
                <span className={`font-extrabold ${selectedItem.stock_count - quantity < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                  {selectedItem.stock_count - quantity}
                </span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-5 pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={onClose}
              className="flex-1 h-16 text-xl font-black rounded-2xl active:scale-95 transition-all dark:border-gray-800"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !itemId || quantity < 1 || (selectedItem && selectedItem.stock_count - quantity < 0)}
              className="flex-1 h-16 text-xl font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl flex items-center justify-center gap-3 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-6 w-6 animate-spin" />
                  Logging...
                </>
              ) : (
                "Log Personal Intake"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
