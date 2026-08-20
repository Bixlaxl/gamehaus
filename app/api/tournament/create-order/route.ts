import { NextResponse } from "next/server";
import { getRazorpayCredentialsForSlug } from "@/lib/razorpay";

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone } = body;

    if (!name || !phone) {
      return NextResponse.json({ success: false, error: "Name and phone are required" }, { status: 400 });
    }

    const creds = getRazorpayCredentialsForSlug("gamehaus");
    const amountInPaise = 40000; // ₹400.00
    const receipt = `tournament_${Date.now()}`;

    // If Razorpay keys are configured, create order via Razorpay API
    if (creds.keyId && creds.keySecret) {
      const credentials = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: "INR",
          receipt,
          notes: {
            tournament: "8-Ball Pool Tournament",
            player_name: name,
            player_phone: phone,
          },
        }),
      });

      if (res.ok) {
        const rpOrder = await res.json();
        return NextResponse.json({
          success: true,
          keyId: creds.keyId,
          orderId: rpOrder.id,
          amount: amountInPaise,
          currency: "INR",
        });
      }
    }

    // Fallback order object if keys are mocked in dev mode
    const mockOrderId = `order_tm_${Date.now()}`;
    return NextResponse.json({
      success: true,
      keyId: creds.keyId || "rzp_test_mockKey123",
      orderId: mockOrderId,
      amount: amountInPaise,
      currency: "INR",
      isMock: true,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
