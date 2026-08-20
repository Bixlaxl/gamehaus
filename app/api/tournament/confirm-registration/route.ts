import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRazorpayCredentialsForSlug } from "@/lib/razorpay";

export const runtime = "nodejs";

// HMAC-SHA256 verification using Node.js crypto
async function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const { createHmac } = await import("crypto");
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = createHmac("sha256", secret).update(body).digest("hex");
  return expectedSignature === signature;
}

// Generate a unique server-side pass ID
function generatePassId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GH-POOL-${suffix}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      name,
      phone,
    } = body as {
      razorpay_payment_id: string;
      razorpay_order_id: string;
      razorpay_signature: string;
      name: string;
      phone: string;
    };

    // ── 1. Input validation ──────────────────────────────────────────────────
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return NextResponse.json(
        { success: false, error: "Missing Razorpay payment fields" },
        { status: 400 }
      );
    }
    if (!name?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { success: false, error: "Name and phone are required" },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      return NextResponse.json(
        { success: false, error: "Invalid phone number" },
        { status: 400 }
      );
    }

    // ── 2. Verify Razorpay HMAC signature ────────────────────────────────────
    const creds = getRazorpayCredentialsForSlug("gamehaus");
    const signatureValid = await verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      creds.keySecret
    );

    if (!signatureValid) {
      console.error("[Tournament] Signature verification failed", {
        razorpay_order_id,
        razorpay_payment_id,
      });
      return NextResponse.json(
        { success: false, error: "Payment signature verification failed. Please contact support." },
        { status: 400 }
      );
    }

    // ── 3. Verify payment with Razorpay API ──────────────────────────────────
    const credentials = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
    const rzpRes = await fetch(
      `https://api.razorpay.com/v1/payments/${razorpay_payment_id}`,
      { headers: { Authorization: `Basic ${credentials}` } }
    );

    if (!rzpRes.ok) {
      const errText = await rzpRes.text();
      console.error("[Tournament] Razorpay payment fetch failed", { errText });
      return NextResponse.json(
        { success: false, error: "Failed to verify payment with Razorpay" },
        { status: 502 }
      );
    }

    const rzpPayment = await rzpRes.json() as {
      id: string;
      order_id: string;
      amount: number;   // in paise
      status: string;   // "captured" | "authorized" | "failed" | ...
    };

    // ── 4. Validate payment status and amount ────────────────────────────────
    if (rzpPayment.status !== "captured" && rzpPayment.status !== "authorized") {
      return NextResponse.json(
        { success: false, error: `Payment is not captured (status: ${rzpPayment.status})` },
        { status: 400 }
      );
    }

    if (rzpPayment.order_id !== razorpay_order_id) {
      return NextResponse.json(
        { success: false, error: "Payment order ID mismatch" },
        { status: 400 }
      );
    }

    const EXPECTED_AMOUNT_PAISE = 40000; // ₹400
    if (rzpPayment.amount < EXPECTED_AMOUNT_PAISE) {
      return NextResponse.json(
        { success: false, error: "Payment amount is insufficient" },
        { status: 400 }
      );
    }

    // ── 5. Idempotency: check if already registered with this payment ID ─────
    const admin = createAdminClient();
    const { data: existing } = await (admin
      .from("tournament_registrations" as any) as any)
      .select("id, pass_id")
      .eq("payment_id", razorpay_payment_id)
      .maybeSingle();

    if (existing) {
      // Already registered — return existing pass (idempotent)
      return NextResponse.json({
        success: true,
        passId: existing.pass_id,
        playerName: name.trim(),
        playerPhone: cleanPhone,
        paymentId: razorpay_payment_id,
        amountPaid: rzpPayment.amount / 100,
        registeredAt: new Date().toISOString(),
      });
    }

    // ── 6. Generate server-side pass ID ──────────────────────────────────────
    const passId = generatePassId();
    const registeredAt = new Date().toISOString();

    const registration = {
      id: `reg-${Date.now()}`,
      name: name.trim(),
      phone: cleanPhone,
      amount: rzpPayment.amount / 100,
      status: "paid",
      payment_id: razorpay_payment_id,
      razorpay_order_id,
      payment_method: "razorpay",
      pass_id: passId,
      created_at: registeredAt,
    };

    // ── 7. Save to database ──────────────────────────────────────────────────
    try {
      await (admin.from("tournament_registrations" as any) as any).insert([registration]);
    } catch (dbErr) {
      // DB table may not exist yet — log but don't block the response
      console.error("[Tournament] DB insert failed (table may not exist):", dbErr);
    }

    // ── 8. Return confirmed registration ─────────────────────────────────────
    return NextResponse.json({
      success: true,
      passId,
      playerName: name.trim(),
      playerPhone: cleanPhone,
      paymentId: razorpay_payment_id,
      amountPaid: rzpPayment.amount / 100,
      registeredAt,
    });
  } catch (err: any) {
    console.error("[Tournament] confirm-registration error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Internal server error" },
      { status: 500 }
    );
  }
}
