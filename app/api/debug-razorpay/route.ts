import { NextResponse } from "next/server";

// TEMPORARY DIAGNOSTIC — remove after Razorpay keys are confirmed working
export const runtime = 'nodejs';

export async function GET() {
  const keyId         = process.env.RAZORPAY_KEY_ID     ?? "";
  const keySecret     = process.env.RAZORPAY_KEY_SECRET  ?? "";
  const pubKey        = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";

  // Test credentials live against Razorpay by calling a harmless read endpoint
  let credentialsValid: boolean | string = false;
  try {
    const credentials = Buffer.from(`${keyId.trim()}:${keySecret.trim()}`).toString("base64");
    const testRes = await fetch("https://api.razorpay.com/v1/orders?count=1", {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Accept": "application/json",
      },
    });
    if (testRes.ok) {
      credentialsValid = true;
    } else {
      const body = await testRes.text();
      credentialsValid = `FAILED (HTTP ${testRes.status}): ${body.slice(0, 200)}`;
    }
  } catch (e: any) {
    credentialsValid = `ERROR: ${e?.message}`;
  }

  const info = {
    credentialTest: credentialsValid,
    RAZORPAY_KEY_ID: {
      present:    keyId.length > 0,
      length:     keyId.length,
      prefix:     keyId.slice(0, 12),
      mode:       keyId.startsWith("rzp_live_") ? "LIVE" : keyId.startsWith("rzp_test_") ? "TEST" : "UNKNOWN_OR_MISSING",
      hasSpaces:  keyId !== keyId.trim(),
    },
    RAZORPAY_KEY_SECRET: {
      present:   keySecret.length > 0,
      length:    keySecret.length,
      prefix:    keySecret.slice(0, 6),
      hasSpaces: keySecret !== keySecret.trim(),
    },
    NEXT_PUBLIC_RAZORPAY_KEY_ID: {
      present:      pubKey.length > 0,
      length:       pubKey.length,
      prefix:       pubKey.slice(0, 12),
      mode:         pubKey.startsWith("rzp_live_") ? "LIVE" : pubKey.startsWith("rzp_test_") ? "TEST" : "UNKNOWN_OR_MISSING",
      matchesKeyId: keyId.trim() === pubKey.trim(),
    },
    RAZORPAY_WEBHOOK_SECRET: {
      present: webhookSecret.length > 0,
      length:  webhookSecret.length,
    },
  };

  return NextResponse.json(info);
}
