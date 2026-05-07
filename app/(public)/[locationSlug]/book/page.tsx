"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCartStore } from "@/store/cart";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2 } from "lucide-react";

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open: () => void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  theme: { color: string };
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
}

export default function CheckoutPage() {
  const router = useRouter();
  const cart = useCartStore();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paymentMode, setPaymentMode] = useState<"advance" | "full">("advance");
  const [coupon, setCoupon] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtotal = cart.items.reduce((s, i) => s + i.amount, 0);
  const amountToPay = paymentMode === "advance" ? 100 * cart.items.length : subtotal;

  async function checkout() {
    if (!name.trim() || !phone.trim()) {
      setError("Name and phone are required");
      return;
    }
    if (cart.items.length === 0) {
      setError("Cart is empty");
      return;
    }

    setLoading(true);
    setError(null);

    // 1. Create internal order
    const orderRes = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location_id: cart.locationId,
        type: "online",
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        items: cart.items.map((i) => ({
          table_id: i.tableId,
          scheduled_start: i.scheduledStart,
          scheduled_end: i.scheduledEnd,
          scheduled_duration_mins: i.durationMins,
          rate_per_hour: i.ratePerHour,
        })),
        coupon_code: coupon.trim() || undefined,
      }),
    });

    const orderBody = await orderRes.json() as
      | { success: true; data: { order_id: string } }
      | { success: false; error: string };

    if (!orderBody.success) {
      setError(orderBody.error);
      setLoading(false);
      return;
    }

    const { order_id } = orderBody.data;

    // 2. Create Razorpay order
    const rpRes = await fetch("/api/payments/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountToPay * 100, // paise
        currency: "INR",
        receipt: order_id,
        order_id,
      }),
    });

    const rpBody = await rpRes.json() as
      | { success: true; data: { razorpay_order_id: string; amount: number } }
      | { success: false; error: string };

    if (!rpBody.success) {
      setError(rpBody.error);
      setLoading(false);
      return;
    }

    // 3. Open Razorpay checkout
    const options: RazorpayOptions = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
      amount: rpBody.data.amount as number,
      currency: "INR",
      order_id: rpBody.data.razorpay_order_id,
      name: "Gamehaus",
      description: paymentMode === "advance" ? "Advance booking" : "Full payment",
      prefill: { name: name.trim(), contact: phone.trim() },
      theme: { color: "#2563EB" },
      handler: async (response) => {
        // Payment captured — Razorpay webhook handles DB update
        // Navigate to confirmation
        cart.clearCart();
        router.push(`/booking/${order_id}?payment_id=${response.razorpay_payment_id}`);
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
    setLoading(false);
  }

  return (
    <>
      {/* Razorpay script */}
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />

      <div className="min-h-screen bg-gray-950 text-white">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
          <h1 className="text-2xl font-bold">Checkout</h1>

          {/* Cart items */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold">Your booking</h2>
            </div>
            {cart.items.map((item, i) => (
              <div
                key={i}
                className="flex items-start justify-between px-5 py-4 border-b border-gray-800 last:border-0"
              >
                <div>
                  <p className="font-medium">{item.tableName}</p>
                  <p className="text-sm text-gray-400">
                    {new Date(item.scheduledStart).toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    {new Date(item.scheduledStart).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    – {new Date(item.scheduledEnd).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold">
                    {formatCurrency(item.amount)}
                  </span>
                  <button
                    onClick={() =>
                      cart.removeItem(item.tableId, item.scheduledStart)
                    }
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            {cart.items.length === 0 && (
              <p className="px-5 py-8 text-center text-gray-500">
                No items in cart
              </p>
            )}
          </div>

          {/* Customer details */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold">Your details</h2>
            <div className="space-y-2">
              <Label className="text-gray-400">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-400">Phone</Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>
          </div>

          {/* Payment mode */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
            <h2 className="font-semibold">Payment</h2>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setPaymentMode("advance")}
                className={`p-3 rounded-lg border text-left transition-all ${
                  paymentMode === "advance"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-700 hover:border-gray-500"
                }`}
              >
                <p className="font-medium">Reserve with ₹100</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Pay rest at venue
                </p>
              </button>
              <button
                onClick={() => setPaymentMode("full")}
                className={`p-3 rounded-lg border text-left transition-all ${
                  paymentMode === "full"
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-gray-700 hover:border-gray-500"
                }`}
              >
                <p className="font-medium">Pay in full</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatCurrency(subtotal)}
                </p>
              </button>
            </div>

            {paymentMode === "full" && (
              <div className="space-y-2">
                <Label className="text-gray-400">Coupon code (optional)</Label>
                <Input
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  placeholder="PROMO10"
                  className="bg-gray-800 border-gray-700 text-white"
                />
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg">
              <span>Pay now</span>
              <span className="text-blue-400">{formatCurrency(amountToPay)}</span>
            </div>
            {paymentMode === "advance" && (
              <p className="text-xs text-gray-500">
                Remaining {formatCurrency(subtotal - amountToPay)} paid at venue. Advance is non-refundable.
              </p>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <Button
            className="w-full bg-blue-600 hover:bg-blue-700 font-bold"
            size="xl"
            onClick={checkout}
            disabled={loading || cart.items.length === 0}
          >
            {loading ? "Processing..." : `Pay ${formatCurrency(amountToPay)}`}
          </Button>
        </div>
      </div>
    </>
  );
}
