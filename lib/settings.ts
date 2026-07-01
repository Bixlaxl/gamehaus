// App-wide configurable settings. Single JSONB row in `app_settings`.
//
// Always read through `getAppSettings()` so missing fields fall back to
// `DEFAULT_SETTINGS` — that way new knobs can ship with code before the owner
// has touched the Settings page.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CancellationTier {
  /** If cancelling at least this many hours before scheduled_start … */
  hours_before: number;
  /** … customer gets back this percentage of what they paid. */
  refund_pct:   number;
}

export interface AppSettings {
  loyalty: {
    /** Customer earns 1 point per this many rupees spent. */
    earn_rupees_per_point:   number;
    /** Each redeemed point reduces the bill by this many rupees. */
    redeem_rupees_per_point: number;
    /** Minimum points balance required before a customer can redeem points. */
    min_points_to_redeem:    number;
  };
  stock: {
    /** Default low-stock threshold for newly created inventory items. */
    default_low_threshold: number;
  };
  booking: {
    /** ₹ per table charged upfront when the customer picks "advance" mode. */
    advance_amount_per_table: number;
    /** Tiered refund policy when the customer paid the full amount upfront.
     *  Sorted descending by hours_before — the first matching tier wins. */
    cancellation_full:    CancellationTier[];
    /** Tiered refund policy when the customer paid only the advance. */
    cancellation_advance: CancellationTier[];
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  loyalty: {
    earn_rupees_per_point:   100,
    redeem_rupees_per_point: 1,
    min_points_to_redeem:    100,
  },
  stock: {
    default_low_threshold: 5,
  },
  booking: {
    advance_amount_per_table: 100,
    cancellation_full: [
      { hours_before: 3, refund_pct: 100 },
      { hours_before: 1, refund_pct: 50  },
    ],
    cancellation_advance: [
      { hours_before: 3, refund_pct: 100 },
      { hours_before: 1, refund_pct: 0   },
    ],
  },
};

/** Deep-merge user-supplied partial settings over the defaults so callers
 *  can rely on every field being defined. */
export function mergeSettings(partial: Partial<AppSettings> | null | undefined): AppSettings {
  if (!partial) return DEFAULT_SETTINGS;
  return {
    loyalty: { ...DEFAULT_SETTINGS.loyalty, ...(partial.loyalty ?? {}) },
    stock:   { ...DEFAULT_SETTINGS.stock,   ...(partial.stock   ?? {}) },
    booking: {
      ...DEFAULT_SETTINGS.booking,
      ...(partial.booking ?? {}),
      cancellation_full:    partial.booking?.cancellation_full    ?? DEFAULT_SETTINGS.booking.cancellation_full,
      cancellation_advance: partial.booking?.cancellation_advance ?? DEFAULT_SETTINGS.booking.cancellation_advance,
    },
  };
}

/** Server-side fetch. Pass an already-built admin or server Supabase client. */
export async function getAppSettings(client: SupabaseClient): Promise<AppSettings> {
  const { data } = await client
    .from("app_settings")
    .select("data")
    .eq("id", 1)
    .single();
  return mergeSettings((data?.data ?? null) as Partial<AppSettings> | null);
}

/** Apply a tier table to a (now, scheduled_start, paid_amount) tuple and
 *  return the refund the customer is entitled to right now. */
export function computeRefund(
  tiers: CancellationTier[],
  nowMs: number,
  scheduledStartMs: number,
  paidAmount: number,
): { refundAmount: number; matchedTier: CancellationTier | null } {
  const hoursLeft = (scheduledStartMs - nowMs) / 3_600_000;
  if (hoursLeft <= 0) return { refundAmount: 0, matchedTier: null };
  // Highest hours_before that we still satisfy wins (most generous tier
  // they qualify for).
  const sorted = [...tiers].sort((a, b) => b.hours_before - a.hours_before);
  const match  = sorted.find((t) => hoursLeft >= t.hours_before) ?? null;
  if (!match) return { refundAmount: 0, matchedTier: null };
  return {
    refundAmount: Math.round(paidAmount * (match.refund_pct / 100) * 100) / 100,
    matchedTier:  match,
  };
}
