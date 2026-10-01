import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";
import { shiftDayStr } from "@/lib/utils";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get("locationId");
  const businessDate = searchParams.get("date"); // YYYY-MM-DD
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");

  if (!locationId) {
    return NextResponse.json(err("locationId required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Try querying the relational daily_accounts table
  let records: any[] = [];
  let tableExists = true;

  try {
    let query = (admin as any)
      .from("daily_accounts")
      .select("*, night_user:users!daily_accounts_night_submitted_by_fkey(name), day_user:users!daily_accounts_day_submitted_by_fkey(name)")
      .eq("location_id", locationId);

    if (businessDate) {
      query = query.eq("business_date", businessDate);
    } else if (fromDate && toDate) {
      query = query.gte("business_date", fromDate).lte("business_date", toDate);
    }
    query = query.order("business_date", { ascending: false });

    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        tableExists = false;
      } else {
        // FK join might fail if foreign keys aren't set up identically; try simple select
        const simple = await (admin as any).from("daily_accounts").select("*").eq("location_id", locationId).order("business_date", { ascending: false });
        if (simple.data) {
          records = simple.data;
        } else {
          tableExists = false;
        }
      }
    } else if (data) {
      records = data.map((r: any) => ({
        ...r,
        night_submitted_by_name: r.night_user?.name || null,
        day_submitted_by_name: r.day_user?.name || null,
      }));
    }
  } catch {
    tableExists = false;
  }

  // 2. If table doesn't exist yet, read from app_settings fallback
  if (!tableExists) {
    const { data: settingsRow } = await admin.from("app_settings").select("data").eq("id", 1).maybeSingle();
    const stored = (settingsRow?.data as any)?.daily_accounts ?? {};
    const list = Object.values(stored) as any[];
    records = list.filter((r) => r.location_id === locationId);
    if (businessDate) {
      records = records.filter((r) => r.business_date === businessDate);
    } else if (fromDate && toDate) {
      records = records.filter((r) => r.business_date >= fromDate && r.business_date <= toDate);
    }
    records.sort((a, b) => b.business_date.localeCompare(a.business_date));
  }

  // 3. For the requested businessDate, compute POS recorded payments hint
  let posHints = null;
  if (businessDate) {
    const dayStartIso = new Date(`${businessDate}T06:00:00+05:30`).toISOString();
    const nextDayStr = shiftDayStr(businessDate, 1);
    const dayEndIso = new Date(`${nextDayStr}T06:00:00+05:30`).toISOString();

    const { data: payments } = await admin
      .from("payments")
      .select("amount, method, status, order:orders!inner(location_id)")
      .eq("orders.location_id", locationId)
      .eq("status", "completed")
      .gte("collected_at", dayStartIso)
      .lte("collected_at", dayEndIso);

    let upiTotal = 0;
    let cashTotal = 0;

    for (const p of (payments as any[]) ?? []) {
      const amt = Number(p.amount) || 0;
      if (p.method === "cash") cashTotal += amt;
      else if (p.method === "upi" || p.method === "razorpay" || p.method === "card") upiTotal += amt;
    }

    posHints = {
      upi_hint: upiTotal,
      cash_hint: cashTotal,
      total_hint: upiTotal + cashTotal,
    };
  }

  // 4. Fetch previous day night closing for handover comparison
  let previousNightClosing: number | null = null;
  if (businessDate) {
    const prevDateStr = shiftDayStr(businessDate, -1);
    const prevRec = records.find((r) => r.business_date === prevDateStr);
    if (prevRec) {
      previousNightClosing = Number(prevRec.night_closing_balance) || 0;
    } else {
      // Query DB for previous day specifically if not in list
      const { data: prevDb } = await (admin as any)
        .from("daily_accounts")
        .select("night_closing_balance")
        .eq("location_id", locationId)
        .eq("business_date", prevDateStr)
        .maybeSingle();
      if (prevDb) previousNightClosing = Number(prevDb.night_closing_balance) || 0;
    }
  }

  return NextResponse.json(
    ok({
      records,
      pos_hints: posHints,
      previous_night_closing: previousNightClosing,
    })
  );
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { action, location_id, business_date } = body;

  if (!location_id || !business_date) {
    return NextResponse.json(err("location_id and business_date are required", "VALIDATION_ERROR"), { status: 400 });
  }

  const admin = createAdminClient();
  const userId = session.user.id;
  const now = new Date().toISOString();

  // Fetch user name
  const { data: userRow } = await admin.from("users").select("name").eq("id", userId).maybeSingle();
  const userName = userRow?.name || "Staff";

  if (action === "night_entry") {
    const upi = Number(body.upi) || 0;
    const cash = Number(body.cash) || 0;
    const opening = Number(body.opening_balance) || 0;
    const expenses = Number(body.expenses) || 0;
    const closing = Number(body.closing_balance) || 0;
    const notes = body.notes || "";

    const totalEarnings = upi + cash;
    const expectedClosing = opening + cash - expenses;
    const diff = Math.round((closing - expectedClosing) * 100) / 100;
    const isTallied = Math.abs(diff) < 0.01;

    const payload = {
      location_id,
      business_date,
      night_upi: upi,
      night_cash: cash,
      night_total_earnings: totalEarnings,
      night_opening_balance: opening,
      night_expenses: expenses,
      night_closing_balance: closing,
      night_expected_closing: expectedClosing,
      night_difference: diff,
      night_is_tallied: isTallied,
      night_submitted_by: userId,
      night_submitted_at: now,
      night_notes: notes,
      updated_at: now,
    };

    // Upsert into relational daily_accounts table
    let savedRow: any = null;
    try {
      const { data, error } = await (admin as any)
        .from("daily_accounts")
        .upsert(payload, { onConflict: "location_id,business_date" })
        .select()
        .single();
      if (!error) savedRow = data;
    } catch {}

    // Fallback sync to app_settings
    const { data: currentSettings } = await admin.from("app_settings").select("data").eq("id", 1).maybeSingle();
    const currentData = (currentSettings?.data ?? {}) as any;
    const dailyAccounts = { ...(currentData.daily_accounts ?? {}) };
    const key = `${location_id}_${business_date}`;
    dailyAccounts[key] = {
      ...(dailyAccounts[key] ?? {}),
      ...payload,
      id: savedRow?.id || dailyAccounts[key]?.id || crypto.randomUUID(),
      night_submitted_by_name: userName,
      created_at: dailyAccounts[key]?.created_at || now,
    };

    await admin.from("app_settings").upsert({
      id: 1,
      data: { ...currentData, daily_accounts: dailyAccounts },
      updated_at: now,
    });

    return NextResponse.json(
      ok({
        record: savedRow || dailyAccounts[key],
        is_tallied: isTallied,
        difference: diff,
      })
    );
  }

  if (action === "day_handover") {
    const opening = Number(body.opening_balance) || 0;
    const notes = body.notes || "";

    // 1. Get previous day's closing balance
    const prevDateStr = shiftDayStr(business_date, -1);
    let prevNightClosing = 0;

    const { data: prevDb } = await (admin as any)
      .from("daily_accounts")
      .select("night_closing_balance")
      .eq("location_id", location_id)
      .eq("business_date", prevDateStr)
      .maybeSingle();

    if (prevDb) {
      prevNightClosing = Number(prevDb.night_closing_balance) || 0;
    } else {
      const { data: currentSettings } = await admin.from("app_settings").select("data").eq("id", 1).maybeSingle();
      const stored = (currentSettings?.data as any)?.daily_accounts ?? {};
      const prevKey = `${location_id}_${prevDateStr}`;
      if (stored[prevKey]) {
        prevNightClosing = Number(stored[prevKey].night_closing_balance) || 0;
      }
    }

    const diff = Math.round((opening - prevNightClosing) * 100) / 100;
    const isTallied = Math.abs(diff) < 0.01;

    const payload = {
      location_id,
      business_date,
      day_opening_balance: opening,
      day_difference: diff,
      day_is_tallied: isTallied,
      day_submitted_by: userId,
      day_submitted_at: now,
      day_notes: notes,
      updated_at: now,
    };

    let savedRow: any = null;
    try {
      const { data, error } = await (admin as any)
        .from("daily_accounts")
        .upsert(payload, { onConflict: "location_id,business_date" })
        .select()
        .single();
      if (!error) savedRow = data;
    } catch {}

    // Fallback sync to app_settings
    const { data: currentSettings } = await admin.from("app_settings").select("data").eq("id", 1).maybeSingle();
    const currentData = (currentSettings?.data ?? {}) as any;
    const dailyAccounts = { ...(currentData.daily_accounts ?? {}) };
    const key = `${location_id}_${business_date}`;
    dailyAccounts[key] = {
      ...(dailyAccounts[key] ?? {}),
      ...payload,
      id: savedRow?.id || dailyAccounts[key]?.id || crypto.randomUUID(),
      day_submitted_by_name: userName,
      created_at: dailyAccounts[key]?.created_at || now,
    };

    await admin.from("app_settings").upsert({
      id: 1,
      data: { ...currentData, daily_accounts: dailyAccounts },
      updated_at: now,
    });

    return NextResponse.json(
      ok({
        record: savedRow || dailyAccounts[key],
        previous_night_closing: prevNightClosing,
        entered_opening: opening,
        difference: diff,
        is_tallied: isTallied,
      })
    );
  }

  return NextResponse.json(err("Invalid action. Must be 'night_entry' or 'day_handover'", "VALIDATION_ERROR"), { status: 400 });
}
