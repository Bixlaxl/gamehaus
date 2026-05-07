"use client";

import { useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import type { Location, Table } from "@/lib/supabase/types";
import { ShoppingCart, Clock, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LocationBrowseProps {
  location: Location;
  tables: Table[];
}

const typeLabel: Record<string, string> = {
  snooker: "Snooker",
  pool: "Pool",
  ps5: "PS5",
};

const typeIcon: Record<string, string> = {
  snooker: "🎱",
  pool: "🎱",
  ps5: "🎮",
};

export function LocationBrowse({ location, tables }: LocationBrowseProps) {
  const cart = useCartStore();
  const [filterType, setFilterType] = useState<string>("all");
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [duration, setDuration] = useState(60);

  // Set location in cart store
  if (cart.locationId !== location.id) {
    cart.setLocation(location.id);
  }

  const types = ["all", ...new Set(tables.map((t) => t.type))];

  const filtered =
    filterType === "all"
      ? tables
      : tables.filter((t) => t.type === filterType);

  function addToCart(table: Table) {
    if (!selectedSlot) return;
    const start = new Date(`${selectedDate}T${selectedSlot}:00`);
    const end = new Date(start.getTime() + duration * 60 * 1000);
    const amount = (duration / 60) * table.hourly_rate;

    cart.addItem({
      tableId: table.id,
      tableName: table.name,
      tableType: table.type,
      ratePerHour: table.hourly_rate,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
      durationMins: duration,
      amount,
    });

    setSelectedTable(null);
    setSelectedSlot(null);
  }

  const cartCount = cart.items.length;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{location.name}</h1>
            <p className="text-sm text-gray-400">{location.address}</p>
          </div>
          <Link href={`/${location.slug}/book`}>
            <Button className="relative bg-blue-600 hover:bg-blue-700">
              <ShoppingCart className="h-4 w-4" />
              Cart
              {cartCount > 0 && (
                <span className="ml-1 bg-white text-blue-600 rounded-full h-5 w-5 flex items-center justify-center text-xs font-bold">
                  {cartCount}
                </span>
              )}
            </Button>
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {types.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filterType === t
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              {t === "all" ? "All" : typeLabel[t] ?? t}
            </button>
          ))}
        </div>

        {/* Table grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((table) => (
            <div
              key={table.id}
              className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden hover:border-gray-600 transition-all cursor-pointer"
              onClick={() => setSelectedTable(table)}
            >
              <div className="h-40 bg-gray-800 flex items-center justify-center">
                {table.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={table.image_url}
                    alt={table.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-8 w-8 text-gray-600" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <span>{typeIcon[table.type]}</span>
                  <h3 className="font-semibold">{table.name}</h3>
                </div>
                {table.size && (
                  <p className="text-xs text-gray-500 mb-1">{table.size}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1 text-sm text-gray-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{formatCurrency(table.hourly_rate)}/hr</span>
                  </div>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTable(table);
                    }}
                  >
                    Book
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slot picker modal */}
      {selectedTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold">
              Book {selectedTable.name}
            </h3>
            <p className="text-sm text-gray-400">
              {formatCurrency(selectedTable.hourly_rate)}/hr
            </p>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">Date</label>
              <input
                type="date"
                value={selectedDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">Start time</label>
              <input
                type="time"
                value={selectedSlot ?? ""}
                onChange={(e) => setSelectedSlot(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">Duration</label>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              >
                {[30, 60, 90, 120, 150, 180].map((m) => (
                  <option key={m} value={m}>
                    {m >= 60
                      ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`
                      : `${m}m`}
                  </option>
                ))}
              </select>
            </div>

            {selectedSlot && (
              <p className="text-sm text-gray-400">
                Total:{" "}
                <span className="text-white font-semibold">
                  {formatCurrency((duration / 60) * selectedTable.hourly_rate)}
                </span>
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1 border-gray-600 text-white hover:bg-gray-800"
                onClick={() => setSelectedTable(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                disabled={!selectedSlot}
                onClick={() => addToCart(selectedTable)}
              >
                Add to Cart
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
