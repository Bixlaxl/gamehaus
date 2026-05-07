"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Booking, Order } from "@/lib/supabase/types";

const supabase = createClient();

type BookingRow = Booking & {
  order: Pick<Order, "customer_name" | "customer_phone">;
  order_item: { table: { name: string; location: { name: string } } };
};

export default function BookingsPage() {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["bookings", date],
    queryFn: async () => {
      const from = new Date(date).toISOString();
      const to = new Date(date + "T23:59:59Z").toISOString();
      const { data } = await supabase
        .from("bookings")
        .select(`
          *,
          order:orders(customer_name, customer_phone),
          order_item:order_items(table:tables(name, location:locations(name)))
        `)
        .gte("scheduled_start", from)
        .lte("scheduled_start", to)
        .order("scheduled_start");
      return (data ?? []) as BookingRow[];
    },
  });

  const refundMutation = useMutation({
    mutationFn: async (_bookingId: string) => {
      // Owner manually processes refund — just mark in system
      alert("Refund processing is handled via Razorpay dashboard. Mark it there and confirm here.");
    },
  });

  const statusColor: Record<string, "success" | "secondary" | "destructive" | "warning" | "outline"> = {
    confirmed: "success",
    checked_in: "default" as "outline",
    no_show: "destructive",
    cancelled: "secondary",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm"
        />
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Table</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {bookings?.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-3 font-mono text-xs text-gray-700">
                  {new Date(b.scheduled_start).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  –{" "}
                  {new Date(b.scheduled_end).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">
                    {b.order?.customer_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {b.order?.customer_phone}
                  </p>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  {b.order_item?.table?.name}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {(b.order_item?.table?.location as { name: string } | null)?.name}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={statusColor[b.status] ?? "outline"}>
                    {b.status.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {b.status === "no_show" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => refundMutation.mutate(b.id)}
                    >
                      Process Refund
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {bookings?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No bookings for this date
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
