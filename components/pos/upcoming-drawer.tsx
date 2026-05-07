"use client";

import { usePOSStore } from "@/store/pos";
import { X } from "lucide-react";

export function UpcomingDrawer() {
  const { upcomingOpen, setUpcomingOpen, tables, now } = usePOSStore();

  if (!upcomingOpen) return null;

  const threeHoursLater = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const upcoming = tables
    .filter((t) => {
      if (!t.upcomingBooking) return false;
      const start = new Date(t.upcomingBooking.scheduled_start);
      return start <= threeHoursLater;
    })
    .map((t) => ({
      table: t,
      booking: t.upcomingBooking!,
    }))
    .sort(
      (a, b) =>
        new Date(a.booking.scheduled_start).getTime() -
        new Date(b.booking.scheduled_start).getTime()
    );

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <div
        className="flex-1 bg-black/50"
        onClick={() => setUpcomingOpen(false)}
      />
      <div className="bg-gray-800 border-t border-gray-700 rounded-t-2xl max-h-80 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            Upcoming (next 3 hours)
          </h2>
          <button
            onClick={() => setUpcomingOpen(false)}
            className="text-gray-400 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-3 space-y-2">
          {upcoming.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-4">
              No upcoming bookings in the next 3 hours
            </p>
          )}
          {upcoming.map(({ table, booking }) => (
            <div
              key={booking.id}
              className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0"
            >
              <div>
                <p className="font-medium text-white">{table.name}</p>
                <p className="text-sm text-gray-400">
                  {booking.order?.customer_name}
                </p>
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-mono text-sm">
                  {new Date(booking.scheduled_start).toLocaleTimeString(
                    "en-IN",
                    { hour: "2-digit", minute: "2-digit" }
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  {booking.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
