"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export function ExtendModal() {
  const { extendModalItem, setExtendModalItem } = usePOSStore();
  const qc = useQueryClient();
  const [customMins, setCustomMins] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function close() {
    setExtendModalItem(null);
    setCustomMins("");
    setError(null);
    setResult(null);
  }

  async function extend(mins: number) {
    if (!extendModalItem) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const res = await fetch("/api/sessions/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order_item_id: extendModalItem.id,
        extend_mins: mins,
      }),
    });

    const body = await res.json() as
      | { success: true; data: { message: string } }
      | { success: false; error: string };

    if (!body.success) {
      setError(body.error);
    } else {
      setResult(body.data.message ?? "Session extended");
      qc.invalidateQueries({ queryKey: ["pos-orders"] });
      setTimeout(close, 1500);
    }
    setLoading(false);
  }

  return (
    <Dialog open={!!extendModalItem} onOpenChange={(open) => !open && close()}>
      <DialogContent className="bg-gray-800 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle>Extend Session</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-gray-400">
            Extending will check for upcoming bookings (10-min buffer).
          </p>

          <div className="grid grid-cols-2 gap-2">
            {[30, 60].map((mins) => (
              <Button
                key={mins}
                variant="outline"
                className="border-gray-600 hover:bg-gray-700 text-white"
                onClick={() => extend(mins)}
                disabled={loading}
              >
                +{mins} min
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Custom (mins)"
              value={customMins}
              onChange={(e) => setCustomMins(e.target.value)}
              className="bg-gray-700 border-gray-600 text-white"
              min="5"
              max="240"
            />
            <Button
              onClick={() => extend(parseInt(customMins))}
              disabled={loading || !customMins}
              className="shrink-0"
            >
              Extend
            </Button>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {result && <p className="text-sm text-green-400">{result}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={close}
            className="border-gray-600 text-white hover:bg-gray-700"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
