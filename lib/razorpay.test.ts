import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRazorpayCredentialsForSlug } from "./razorpay";

describe("Razorpay Credentials Resolver", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = "gamehaus_key";
    process.env.RAZORPAY_KEY_SECRET = "gamehaus_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "gamehaus_webhook";

    process.env.NERFTURF_RAZORPAY_KEY_ID = "nerfturf_key";
    process.env.NERFTURF_RAZORPAY_KEY_SECRET = "nerfturf_secret";
    process.env.NERFTURF_RAZORPAY_WEBHOOK_SECRET = "nerfturf_webhook";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should resolve default credentials for gamehaus slug", () => {
    const creds = getRazorpayCredentialsForSlug("gamehaus");
    expect(creds.keyId).toBe("gamehaus_key");
    expect(creds.keySecret).toBe("gamehaus_secret");
    expect(creds.webhookSecret).toBe("gamehaus_webhook");
  });

  it("should resolve nerf-turf credentials for nerf-turf slug", () => {
    const creds = getRazorpayCredentialsForSlug("nerf-turf");
    expect(creds.keyId).toBe("nerfturf_key");
    expect(creds.keySecret).toBe("nerfturf_secret");
    expect(creds.webhookSecret).toBe("nerfturf_webhook");
  });

  it("should resolve nerf-turf credentials for nerfturf slug", () => {
    const creds = getRazorpayCredentialsForSlug("nerfturf");
    expect(creds.keyId).toBe("nerfturf_key");
    expect(creds.keySecret).toBe("nerfturf_secret");
    expect(creds.webhookSecret).toBe("nerfturf_webhook");
  });

  it("should fallback to default for unknown slug or null", () => {
    const creds = getRazorpayCredentialsForSlug(null);
    expect(creds.keyId).toBe("gamehaus_key");
    expect(creds.keySecret).toBe("gamehaus_secret");
    expect(creds.webhookSecret).toBe("gamehaus_webhook");
  });
});
