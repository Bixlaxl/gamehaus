export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * Resolves Razorpay credentials based on location slug.
 * If slug includes 'nerfturf', checks NERFTURF_RAZORPAY_* env vars first.
 * Falls back to default RAZORPAY_* env vars if NerfTurf env vars are empty or for other locations.
 */
export function getRazorpayCredentialsForSlug(slug?: string | null): RazorpayCredentials {
  const cleanSlug = (slug || "").toLowerCase().trim();

  const defaultKeyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const defaultKeySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();
  const defaultWebhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();

  if (cleanSlug.includes("nerfturf")) {
    const nerfKeyId = (process.env.NERFTURF_RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_NERFTURF_RAZORPAY_KEY_ID || "").trim();
    const nerfKeySecret = (process.env.NERFTURF_RAZORPAY_KEY_SECRET || "").trim();
    const nerfWebhookSecret = (process.env.NERFTURF_RAZORPAY_WEBHOOK_SECRET || "").trim();

    return {
      keyId: nerfKeyId || defaultKeyId,
      keySecret: nerfKeySecret || defaultKeySecret,
      webhookSecret: nerfWebhookSecret || defaultWebhookSecret,
    };
  }

  return {
    keyId: defaultKeyId,
    keySecret: defaultKeySecret,
    webhookSecret: defaultWebhookSecret,
  };
}

/**
 * Fetches order's location_id and location slug from Supabase, then resolves matching Razorpay credentials.
 */
export async function getRazorpayCredentialsForOrder(
  admin: any,
  orderId: string
): Promise<RazorpayCredentials> {
  try {
    const { data: order } = await admin
      .from("orders")
      .select("location_id, location:locations(slug)")
      .eq("id", orderId)
      .maybeSingle();

    const slug = (order as any)?.location?.slug ?? null;
    return getRazorpayCredentialsForSlug(slug);
  } catch (err) {
    console.error("[Razorpay Credentials Lookup Error]", err);
    return getRazorpayCredentialsForSlug(null);
  }
}
