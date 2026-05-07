"use client";

import { useState } from "react";
import { usePOSStore, getSelectedOrder } from "@/store/pos";
import { calculateBill } from "@/lib/billing/engine";
import { formatCurrency, formatCountdown, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import type { OrderItem } from "@/lib/supabase/types";

interface OrderPanelProps {
  locationId: string;
}

export function OrderPanel({ locationId: _locationId }: OrderPanelProps) {
  const store = usePOSStore();
  const selectedOrder = getSelectedOrder(store);
  const now = store.now;

  const [addExtraOpen, setAddExtraOpen] = useState(false);
  const [extraForm, setExtraForm] = useState({
    name: "",
    price: "",
    quantity: "1",
  });
  const [extraLoading, setExtraLoading] = useState(false);

  if (!selectedOrder) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <p className="text-lg">No order selected</p>
          <p className="text-sm mt-1">Tap a table or start a new walk-in</p>
        </div>
      </div>
    );
  }

  const activeItems = selectedOrder.items.filter(
    (i) => i.status !== "cancelled" && !i.is_deleted
  );
  const activeExtras = selectedOrder.extras.filter((e) => !e.is_deleted);

  const bill = calculateBill(activeItems, activeExtras, now);

  async function stopSession(item: OrderItem) {
    const res = await fetch("/api/sessions/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_item_id: item.id }),
    });
    if (!res.ok) {
      const body = await res.json() as { error?: string };
      alert(body.error ?? "Failed to stop session");
    }
  }

  async function addExtra() {
    if (!extraForm.name || !extraForm.price) return;
    setExtraLoading(true);
    const res = await fetch(`/api/orders/${selectedOrder!.id}/extras`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: extraForm.name,
        price: parseFloat(extraForm.price),
        quantity: parseInt(extraForm.quantity),
      }),
    });
    if (res.ok) {
      setExtraForm({ name: "", price: "", quantity: "1" });
      setAddExtraOpen(false);
    }
    setExtraLoading(false);
  }

  async function deleteExtra(extraId: string) {
    await fetch(`/api/orders/${selectedOrder!.id}/extras/${extraId}`, {
      method: "DELETE",
    });
  }

  return (
    <div className="h-full flex flex-col bg-gray-850">
      {/* Customer header */}
      <div className="px-5 py-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-white">
              {selectedOrder.customer_name}
            </p>
            {selectedOrder.customer_phone && (
              <p className="text-sm text-gray-400">
                📞 {selectedOrder.customer_phone}
              </p>
            )}
          </div>
          <span className="text-xs text-gray-500 uppercase">
            {selectedOrder.type === "walk_in" ? "Walk-in" : "Online"}
          </span>
        </div>
      </div>

      {/* Table sessions */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {activeItems.map((item) => {
          const isRunning = item.status === "running";
          const lineBill = calculateBill([item], [], now);
          const liveAmount = lineBill.subtotal;

          let countdown = "";
          let isOvertime = false;
          if (isRunning && item.expected_end) {
            const expectedEnd = new Date(item.expected_end);
            countdown = formatCountdown(expectedEnd, now);
            isOvertime = expectedEnd.getTime() < now.getTime();
          }

          const tableInfo = item.table ?? { name: "Table", type: "snooker" };

          return (
            <div
              key={item.id}
              className={cn(
                "bg-gray-800 rounded-lg p-4 border",
                isRunning && !isOvertime && "border-green-600",
                isRunning && isOvertime && "border-red-500",
                !isRunning && "border-gray-700"
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-white">
                    {(tableInfo as { name: string }).name}
                  </p>
                  {isRunning && (
                    <p
                      className={cn(
                        "text-sm font-mono",
                        isOvertime ? "text-red-400" : "text-green-400"
                      )}
                    >
                      {isOvertime ? "OVERTIME" : countdown + " remaining"}
                    </p>
                  )}
                  {item.status === "scheduled" && (
                    <p className="text-sm text-amber-400">Scheduled</p>
                  )}
                  {item.status === "finished" && (
                    <p className="text-sm text-gray-400">Finished</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold">
                    {formatCurrency(liveAmount)}
                  </p>
                  <p className="text-xs text-gray-400">
                    ₹{item.rate_per_hour}/hr
                  </p>
                </div>
              </div>

              {isRunning && (
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => stopSession(item)}
                    className="flex-1"
                  >
                    Stop
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => store.setExtendModalItem(item)}
                    className="flex-1 border-gray-600 text-white hover:bg-gray-700"
                  >
                    Extend
                  </Button>
                </div>
              )}

              {item.status === "scheduled" && (
                <Button
                  size="sm"
                  className="mt-3 w-full bg-green-600 hover:bg-green-700"
                  onClick={async () => {
                    await fetch("/api/sessions/start", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ order_item_id: item.id }),
                    });
                  }}
                >
                  Start Session
                </Button>
              )}
            </div>
          );
        })}

        {/* Extras */}
        <div className="border-t border-gray-700 pt-3">
          <p className="text-xs text-gray-500 uppercase mb-2">Extras</p>
          {activeExtras.map((extra) => (
            <div
              key={extra.id}
              className="flex items-center justify-between py-1.5"
            >
              <div>
                <span className="text-sm text-white">{extra.name}</span>
                <span className="text-xs text-gray-400 ml-2">
                  ×{extra.quantity}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white">
                  {formatCurrency(extra.price * extra.quantity)}
                </span>
                <button
                  onClick={() => deleteExtra(extra.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {/* Add extra inline */}
          {addExtraOpen ? (
            <div className="bg-gray-800 rounded-lg p-3 mt-2 space-y-2 border border-gray-600">
              <Input
                placeholder="Item name"
                value={extraForm.name}
                onChange={(e) =>
                  setExtraForm({ ...extraForm, name: e.target.value })
                }
                className="bg-gray-700 border-gray-600 text-white"
              />
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Price"
                  value={extraForm.price}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, price: e.target.value })
                  }
                  className="bg-gray-700 border-gray-600 text-white"
                />
                <Input
                  type="number"
                  placeholder="Qty"
                  value={extraForm.quantity}
                  onChange={(e) =>
                    setExtraForm({ ...extraForm, quantity: e.target.value })
                  }
                  className="bg-gray-700 border-gray-600 text-white w-20"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={addExtra}
                  disabled={extraLoading}
                  className="flex-1"
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddExtraOpen(false)}
                  className="border-gray-600 text-white hover:bg-gray-700"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddExtraOpen(true)}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mt-2 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Beverage / Extra
            </button>
          )}
        </div>
      </div>

      {/* Bill summary + finalize */}
      <div className="px-5 py-4 border-t border-gray-700 bg-gray-800 space-y-2 shrink-0">
        {bill.discountAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Discount</span>
            <span className="text-green-400">
              -{formatCurrency(bill.discountAmount)}
            </span>
          </div>
        )}
        {bill.advancePaid > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Advance paid</span>
            <span className="text-green-400">
              -{formatCurrency(bill.advancePaid)}
            </span>
          </div>
        )}
        <div className="flex justify-between items-center">
          <span className="font-semibold text-white">Subtotal</span>
          <span className="text-xl font-bold text-white">
            {formatCurrency(bill.subtotal)}
          </span>
        </div>
        <Button
          size="xl"
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
          onClick={() => store.setFinalizeOrderId(selectedOrder.id)}
          disabled={activeItems.some((i) => i.status === "running")}
        >
          Finalize Bill
          {activeItems.some((i) => i.status === "running") &&
            " (stop sessions first)"}
        </Button>
      </div>
    </div>
  );
}
