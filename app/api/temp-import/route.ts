import { NextResponse } from "next/server";
import * as fs from "fs";
import { createAdminClient } from "@/lib/supabase/admin";

function parseCSVDate(datePart: string, timePart: string): string {
  try {
    const dParts = datePart.trim().split("/");
    const tParts = timePart.trim().split(":");
    if (dParts.length !== 3 || tParts.length !== 3) {
      return new Date().toISOString();
    }
    // DD/MM/YYYY
    const day = parseInt(dParts[0]);
    const month = parseInt(dParts[1]) - 1;
    const year = parseInt(dParts[2]);
    
    const hours = parseInt(tParts[0]);
    const minutes = parseInt(tParts[1]);
    const seconds = parseInt(tParts[2]);

    const date = new Date(year, month, day, hours, minutes, seconds);
    return date.toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const passcode = searchParams.get("passcode");
    if (passcode !== "gamehaus-import-2026") {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const path = require("path");
    const admin = createAdminClient();

    // 1. Get NerfTurf location ID
    const { data: locations, error: locError } = await admin
      .from("locations")
      .select("id, name");

    if (locError) {
      return NextResponse.json({ success: false, error: "Failed to fetch locations: " + locError.message });
    }

    const nerfLoc = locations?.find(l => l.name.toLowerCase().includes("nerf")) || locations?.[0];
    if (!nerfLoc) {
      return NextResponse.json({ success: false, error: "No locations found in database" });
    }
    const locationId = nerfLoc.id;

    // 2. Fetch or create a default membership plan if empty
    const { data: plans, error: planError } = await admin
      .from("membership_plans")
      .select("id, name");
    
    if (planError) {
      return NextResponse.json({ success: false, error: "Failed to fetch plans: " + planError.message });
    }

    const crypto = require("crypto");
    let planId = plans?.[0]?.id;
    if (!planId) {
      const defaultPlanId = crypto.randomUUID();
      const { error: createPlanError } = await admin
        .from("membership_plans")
        .insert({
          id: defaultPlanId,
          name: "Premium Membership",
          price: 1000,
          duration_days: 30,
          discount_pct: 0,
          free_hrs: 0,
          is_active: true
        });
      if (createPlanError) {
        return NextResponse.json({ success: false, error: "Failed to create default membership plan: " + createPlanError.message });
      }
      planId = defaultPlanId;
    }

    // 3. Clean slate: Delete ALL existing orders & payments for NerfTurf location in batches
    const { data: ordersToDelete } = await admin
      .from("orders")
      .select("id")
      .eq("location_id", locationId);

    if (ordersToDelete && ordersToDelete.length > 0) {
      const orderIds = ordersToDelete.map(o => o.id);
      const deleteBatchSize = 100;
      
      for (let i = 0; i < orderIds.length; i += deleteBatchSize) {
        const batchIds = orderIds.slice(i, i + deleteBatchSize);
        
        const { error: payDeleteError } = await admin
          .from("payments")
          .delete()
          .in("order_id", batchIds);
        if (payDeleteError) {
          return NextResponse.json({ success: false, error: `Failed to delete old payments batch ${i}: ` + payDeleteError.message });
        }

        const { error: ordDeleteError } = await admin
          .from("orders")
          .delete()
          .in("id", batchIds);
        if (ordDeleteError) {
          return NextResponse.json({ success: false, error: `Failed to delete old orders batch ${i}: ` + ordDeleteError.message });
        }
      }
    }

    // 4. Parse CSV files
    const csvRecordsMap = new Map();

    // Helper to parse a CSV
    const parseCSV = (filename: string) => {
      const csvPath = path.join(process.cwd(), filename);
      if (!fs.existsSync(csvPath)) return;
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(",");
        if (parts.length < 8) continue;

        const id = parts[0].trim();
        const name = parts[1].trim();
        let phone = parts[2].trim().replace(/\D/g, "");
        if (phone.length === 12 && phone.startsWith("91")) {
          phone = phone.substring(2);
        }
        if (phone.length !== 10) continue;

        const isMember = parts[4].trim() === "true";
        const pointsBalance = parseInt(parts[5].trim()) || 0;
        const totalSpent = parseFloat(parts[6].trim()) || 0;
        const datePart = parts[7];
        const timePart = parts[8] || "00:00:00";
        const createdAt = parseCSVDate(datePart, timePart);

        const existing = csvRecordsMap.get(phone);
        if (existing) {
          existing.total_spent += totalSpent;
          existing.points_balance += pointsBalance;
          existing.visit_count += totalSpent > 0 ? 1 : 0;
          if (isMember) existing.isMember = true;
          if (filename.includes("(1)") && totalSpent > 0) {
            existing.hasNerfTurfSpend = true;
            existing.nerfTurfSpent = (existing.nerfTurfSpent || 0) + totalSpent;
          }
        } else {
          csvRecordsMap.set(phone, {
            id,
            phone,
            name: name || null,
            isMember,
            points_balance: pointsBalance,
            total_spent: totalSpent,
            created_at: createdAt,
            visit_count: totalSpent > 0 ? 1 : 0,
            hasNerfTurfSpend: filename.includes("(1)") && totalSpent > 0,
            nerfTurfSpent: filename.includes("(1)") && totalSpent > 0 ? totalSpent : 0
          });
        }
      }
    };

    parseCSV("customers (2).csv"); // Gamehaus
    parseCSV("customers (1).csv"); // NerfTurf

    const csvRecords = Array.from(csvRecordsMap.values());

    // 5. Delete existing old memberships for NerfTurf customers
    const csvPhones = csvRecords.map(r => r.phone);
    const { error: membDeleteError } = await admin
      .from("customer_memberships")
      .delete()
      .in("customer_phone", csvPhones);

    if (membDeleteError) {
      return NextResponse.json({ success: false, error: "Failed to delete old memberships: " + membDeleteError.message });
    }

    // 6. Fetch 2026 orders to add to totals
    const { data: orders2026 } = await admin
      .from("orders")
      .select("customer_phone, total_amount, points_redeemed")
      .eq("status", "finalized")
      .gte("created_at", "2026-01-01T00:00:00Z");

    const orders2026Map = new Map();
    for (const o of (orders2026 ?? [])) {
      if (!o.customer_phone) continue;
      const existing = orders2026Map.get(o.customer_phone) || { total: 0, redeemed: 0, count: 0 };
      existing.total += o.total_amount;
      existing.redeemed += o.points_redeemed || 0;
      existing.count += 1;
      orders2026Map.set(o.customer_phone, existing);
    }

    // 7. Get earn rupees settings for points
    const { data: settingsRow } = await admin.from("settings").select("value").eq("key", "app_settings").maybeSingle();
    const earnRupees = (settingsRow as any)?.value?.loyalty?.earn_rupees_per_point || 100;

    // 8. Fetch current DB profiles to keep existing DB ids
    const { data: existingProfiles } = await admin
      .from("customer_profiles")
      .select("id, phone");
    const dbProfileMap = new Map(existingProfiles?.map(p => [p.phone, p.id]));

    // 9. Prepare DB modifications
    const profilesToUpsert = [];
    const ordersToInsert = [];
    const paymentsToInsert = [];
    const membershipsToInsert = [];

    for (const csv of csvRecords) {
      const orders2026Data = orders2026Map.get(csv.phone) || { total: 0, redeemed: 0, count: 0 };
      
      const cleanTotalSpent = csv.total_spent + orders2026Data.total;
      const cleanVisitCount = csv.visit_count + orders2026Data.count;
      const cleanPointsBalance = csv.points_balance + Math.floor(orders2026Data.total / earnRupees) - orders2026Data.redeemed;
      
      const existingId = dbProfileMap.get(csv.phone);

      profilesToUpsert.push({
        id: existingId || csv.id,
        phone: csv.phone,
        name: csv.name,
        points_balance: Math.max(0, cleanPointsBalance),
        total_spent: cleanTotalSpent,
        visit_count: cleanVisitCount,
        created_at: csv.created_at
      });

      // Insert historical orders for NerfTurf spent customers (from NerfTurf CSV)
      if (csv.hasNerfTurfSpend && csv.nerfTurfSpent > 0) {
        const orderId = crypto.randomUUID();
        ordersToInsert.push({
          id: orderId,
          location_id: locationId,
          type: "walk_in" as const,
          customer_name: csv.name || "Customer",
          customer_phone: csv.phone,
          status: "finalized" as const,
          subtotal: csv.nerfTurfSpent,
          discount_amount: 0,
          public_discount_amount: 0,
          total_amount: csv.nerfTurfSpent,
          advance_paid: 0,
          amount_due: csv.nerfTurfSpent,
          points_redeemed: 0,
          created_at: csv.created_at,
          finalized_at: csv.created_at
        });

        paymentsToInsert.push({
          order_id: orderId,
          amount: csv.nerfTurfSpent,
          method: "cash" as const,
          status: "completed" as const,
          created_at: csv.created_at
        });
      }

      // Add memberships if Is Member is true
      if (csv.isMember) {
        membershipsToInsert.push({
          customer_phone: csv.phone,
          plan_id: planId,
          starts_at: csv.created_at,
          expires_at: new Date(new Date(csv.created_at).setMonth(new Date(csv.created_at).getMonth() + 1)).toISOString(),
          is_active: true,
          free_hrs_used: 0,
          free_hours_ledger: {},
          created_at: csv.created_at
        });
      }
    }

    // 10. Execute DB operations in batches
    const batchSize = 100;
    
    // Profiles
    for (let i = 0; i < profilesToUpsert.length; i += batchSize) {
      const batch = profilesToUpsert.slice(i, i + batchSize);
      const { error } = await admin.from("customer_profiles").upsert(batch, { onConflict: "phone" });
      if (error) return NextResponse.json({ success: false, error: `Profiles batch ${i} failed: ${error.message}` });
    }

    // Orders
    for (let i = 0; i < ordersToInsert.length; i += batchSize) {
      const batch = ordersToInsert.slice(i, i + batchSize);
      const { error } = await admin.from("orders").insert(batch);
      if (error) return NextResponse.json({ success: false, error: `Orders batch ${i} failed: ${error.message}` });
    }

    // Payments
    for (let i = 0; i < paymentsToInsert.length; i += batchSize) {
      const batch = paymentsToInsert.slice(i, i + batchSize);
      const { error } = await admin.from("payments").insert(batch);
      if (error) return NextResponse.json({ success: false, error: `Payments batch ${i} failed: ${error.message}` });
    }

    // Memberships
    for (let i = 0; i < membershipsToInsert.length; i += batchSize) {
      const batch = membershipsToInsert.slice(i, i + batchSize);
      const { error } = await admin.from("customer_memberships").insert(batch);
      if (error) return NextResponse.json({ success: false, error: `Memberships batch ${i} failed: ${error.message}` });
    }

    return NextResponse.json({
      success: true,
      locationAssigned: nerfLoc.name,
      importedProfiles: profilesToUpsert.length,
      createdOrders: ordersToInsert.length,
      createdPayments: paymentsToInsert.length,
      createdMemberships: membershipsToInsert.length
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
