import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppConfirmation, sendWhatsAppCancellation } from "@/lib/whatsapp";
import { getRazorpayCredentialsForOrder } from "@/lib/razorpay";

export const runtime = 'edge';

async function verifyHmac(secret: string, body: string, signature: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const secrets = [
    (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim(),
    (process.env.NERFTURF_RAZORPAY_WEBHOOK_SECRET || "").trim(),
  ].filter(Boolean);

  let verified = false;
  for (const s of secrets) {
    if (await verifyHmac(s, body, signature)) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(body) as {
    event: string;
    payload: {
      payment?: {
        entity: {
          id: string;
          order_id: string; // Razorpay order ID
          amount: number;   // in paise
          status: string;
        };
      };
      refund?: {
        entity: {
          id: string;
          payment_id: string;
          amount: number;
          status: string;
          error_description?: string;
        };
      };
    };
  };

  // ── Handle refund status events ──────────────────────────────────────────────
  if (event.event === "refund.processed" || event.event === "refund.failed") {
    const refund = event.payload.refund?.entity;
    if (!refund) return NextResponse.json({ received: true });

    const admin = createAdminClient();
    const refundStatus = event.event === "refund.processed" ? "refunded" : "failed";

    // Update the negative payment row that was inserted when refund was initiated
    await admin
      .from("payments")
      .update({ status: refundStatus })
      .eq("razorpay_payment_id", refund.id);

    if (event.event === "refund.failed") {
      console.error(
        `[CRITICAL_REFUND_FAILURE] Razorpay refund ${refund.id} for payment ` +
        `${refund.payment_id} failed: ${refund.error_description ?? "unknown"}. MANUAL REFUND REQUIRED.`
      );
    }

    return NextResponse.json({ received: true });
  }

  // ── Handle payment capture events ───────────────────────────────────────────
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const payment = event.payload.payment?.entity;
    if (!payment) return NextResponse.json({ received: true });

    const admin = createAdminClient();

    // ── Look up our internal payment row ────────────────────────────────────
    const { data: paymentRow } = await admin
      .from("payments")
      .select("id, order_id, amount, status, method")
      .eq("razorpay_order_id", payment.order_id)
      .maybeSingle();

    if (paymentRow) {
      const orderId = paymentRow.order_id;
      // Razorpay sends amounts in paise; convert to rupees for our RPC
      const verifiedAmountRupees = payment.amount / 100;

      // ── Delegate to the atomic confirm_order_payment RPC ─────────────────
      // The RPC handles:
      //   • Idempotency (only claims 'pending' rows)
      //   • Advance paid accumulation (COALESCE + add)
      //   • Booking insertion with ON CONFLICT DO NOTHING
      //   • Coupon used_count increment
      //   • Customer profile loyalty upsert
      const { data: rpcResult, error: rpcError } = await (admin as any)
        .rpc("confirm_order_payment", {
          p_order_id:             orderId,
          p_razorpay_order_id:    payment.order_id,
          p_razorpay_payment_id:  payment.id,
          p_verified_amount:      verifiedAmountRupees,
          p_method:               paymentRow.method ?? "razorpay",
        });

      if (rpcError) {
        console.error(`[Webhook] confirm_order_payment RPC error for order ${orderId}:`, rpcError);
        // Return 200 so Razorpay does not retry — the unique index on razorpay_payment_id
        // will prevent a double-credit even if the webhook fires again.
        return NextResponse.json({ received: true });
      }

      const result = rpcResult as {
        success: boolean;
        already_processed?: boolean;
        error?: string;
        customer_phone?: string;
        order_status?: string;
      };

      // Already handled by a concurrent webhook or confirm-online — exit cleanly
      if (!result.success || result.already_processed) {
        console.log(`[Webhook] Payment for order ${orderId} already processed. Skipping.`);
        return NextResponse.json({ received: true });
      }

      // ── Dispatch WhatsApp confirmation (non-fatal if it fails) ────────────
      sendWhatsAppConfirmation(orderId).catch((e) =>
        console.error(`[Webhook] WhatsApp confirmation failed for order ${orderId}:`, e)
      );

      return NextResponse.json({ received: true });
    }

    // ── Handle tournament payments (webhook fallback) ─────────────────────────
    // Fires when Razorpay captures payment but the client callback failed
    // (browser closed, network drop). Ensures no paid player is left unregistered.
    try {
      const { data: tournamentReg } = await (admin
        .from("tournament_registrations" as any) as any)
        .select("id, pass_id, status")
        .eq("razorpay_order_id", payment.order_id)
        .maybeSingle();

      if (tournamentReg && tournamentReg.status !== "paid") {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let suffix = "";
        for (let i = 0; i < 6; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
        const passId = tournamentReg.pass_id || `GH-POOL-${suffix}`;

        await (admin.from("tournament_registrations" as any) as any)
          .update({ status: "paid", payment_id: payment.id, pass_id: passId })
          .eq("id", tournamentReg.id);

        console.log(`[Webhook] Tournament ${tournamentReg.id} confirmed via webhook fallback. Pass: ${passId}`);
      }
    } catch (err) {
      console.error("[Webhook] Tournament fallback check failed:", err);
    }
  }

  return NextResponse.json({ received: true });
}
