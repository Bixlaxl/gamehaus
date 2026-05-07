"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePOSStore } from "@/store/pos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Booking, Order } from "@/lib/supabase/types";

interface CheckinSliderProps {
  locationId: string;
}

const supabase = createClient();

type BookingWithOrder = Booking & { order: Pick<Order, "customer_name" | "customer_phone"> };

export function CheckinSlider({ locationId }: CheckinSliderProps) {
  const { checkinOpen, setCheckinOpen, selectOrder } = usePOSStore();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BookingWithOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setSearch("");
    setResults([]);
    setError(null);
    setCheckinOpen(false);
  }

  async function doSearch() {
    if (!search.trim()) return;
    setSearching(true);
    setError(null);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data, error: dbError } = await supabase
      .from("bookings")
      .select(`
        *,
        order:orders(customer_name, customer_phone, location_id)
      `)
      .eq("status", "confirmed")
      .gte("scheduled_start", today.toISOString())
      .lt("scheduled_start", tomorrow.toISOString());

    if (dbError) {
      setError(dbError.message);
      setSearching(false);
      return;
    }

    const term = search.toLowerCase();
    const filtered = (data ?? []).filter((b) => {
      const o = b.order as { customer_name: string; customer_phone: string | null; location_id: string };
      return (
        o.location_id === locationId &&
        (o.customer_name.toLowerCase().includes(term) ||
          (o.customer_phone ?? "").includes(term))
      );
    }) as BookingWithOrder[];

    setResults(filtered);
    setSearching(false);
  }

  async function checkIn(booking: BookingWithOrder) {
    setCheckingIn(booking.id);
    setError(null);

    const res = await fetch(`/api/bookings/${booking.id}/checkin`, {
      method: "POST",
    });

    const body = await res.json() as
      | { success: true; data: { order_id: string } }
      | { success: false; error: string };

    if (!body.success) {
      setError(body.error);
      setCheckingIn(null);
      return;
    }

    qc.invalidateQueries({ queryKey: ["pos-orders", locationId] });
    qc.invalidateQueries({ queryKey: ["pos-tables", locationId] });
    qc.invalidateQueries({ queryKey: ["pos-bookings", locationId] });
    selectOrder(body.data.order_id);
    close();
    setCheckingIn(null);
  }

  if (!checkinOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/50" onClick={close} />
      <div className="w-96 bg-gray-800 border-l border-gray-700 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Check-in Booking</h2>
          <button onClick={close} className="text-gray-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="Name or phone number..."
              className="bg-gray-700 border-gray-600 text-white"
            />
            <Button onClick={doSearch} disabled={searching}>
              Search
            </Button>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="space-y-2">
            {results.map((booking) => (
              <div
                key={booking.id}
                className="bg-gray-700 rounded-lg p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">
                      {booking.order?.customer_name}
                    </p>
                    <p className="text-xs text-gray-400">
                      {new Date(booking.scheduled_start).toLocaleTimeString(
                        "en-IN",
                        { hour: "2-digit", minute: "2-digit" }
                      )}{" "}
                      –{" "}
                      {new Date(booking.scheduled_end).toLocaleTimeString(
                        "en-IN",
                        { hour: "2-digit", minute: "2-digit" }
                      )}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => checkIn(booking)}
                    disabled={checkingIn === booking.id}
                  >
                    {checkingIn === booking.id ? "..." : "Check In"}
                  </Button>
                </div>
              </div>
            ))}
            {results.length === 0 && search && !searching && (
              <p className="text-sm text-gray-500 text-center py-4">
                No confirmed bookings found
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
