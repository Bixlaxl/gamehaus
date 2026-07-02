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
    const csvPath = path.join(process.cwd(), "customers (2).csv");
    if (!fs.existsSync(csvPath)) {
      return NextResponse.json({ success: false, error: "CSV file not found at " + csvPath });
    }

    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n");
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(",");
      if (parts.length < 8) {
        continue;
      }

      let phone = parts[2].trim();
      phone = phone.replace(/\D/g, "");
      if (phone.length === 12 && phone.startsWith("91")) {
        phone = phone.substring(2);
      }
      
      if (phone.length !== 10) {
        continue;
      }

      const name = parts[1].trim();
      const pointsBalance = parseInt(parts[5].trim()) || 0;
      const totalSpent = parseFloat(parts[6].trim()) || 0;
      
      const datePart = parts[7];
      const timePart = parts[8] || "00:00:00";
      const createdAt = parseCSVDate(datePart, timePart);

      records.push({
        phone,
        name: name || null,
        points_balance: pointsBalance,
        total_spent: totalSpent,
        created_at: createdAt,
        visit_count: totalSpent > 0 ? 1 : 0
      });
    }

    // Deduplicate records by phone number
    const uniqueMap = new Map();
    for (const rec of records) {
      uniqueMap.set(rec.phone, rec);
    }
    const deduplicatedRecords = Array.from(uniqueMap.values());

    const admin = createAdminClient();

    // 1. Get Gamehaus location ID
    const { data: locations, error: locError } = await admin
      .from("locations")
      .select("id, name");

    if (locError) {
      return NextResponse.json({ success: false, error: "Failed to fetch locations: " + locError.message });
    }

    const gamehausLoc = locations?.find(l => l.name.toLowerCase().includes("gamehaus")) || locations?.[0];
    if (!gamehausLoc) {
      return NextResponse.json({ success: false, error: "No locations found in database" });
    }
    const locationId = gamehausLoc.id;

    // 2. Fetch existing finalized orders to avoid duplicating them
    const { data: existingOrders, error: existError } = await admin
      .from("orders")
      .select("customer_phone")
      .eq("status", "finalized");

    if (existError) {
      return NextResponse.json({ success: false, error: "Failed to fetch existing orders: " + existError.message });
    }

    const existingPhones = new Set(existingOrders?.map(o => o.customer_phone).filter(Boolean));

    // 3. Prepare inserts for customer profiles, orders, and payments
    const crypto = require("crypto");
    const profilesToUpsert = [];
    const ordersToInsert = [];
    const paymentsToInsert = [];

    for (const rec of deduplicatedRecords) {
      profilesToUpsert.push({
        phone: rec.phone,
        name: rec.name,
        points_balance: rec.points_balance,
        total_spent: rec.total_spent,
        created_at: rec.created_at,
        visit_count: rec.visit_count
      });

      // Only create order history if they spent money and don't already have finalized orders
      if (rec.total_spent > 0 && !existingPhones.has(rec.phone)) {
        const orderId = crypto.randomUUID();
        ordersToInsert.push({
          id: orderId,
          location_id: locationId,
          type: "walk_in" as const,
          customer_name: rec.name || "Customer",
          customer_phone: rec.phone,
          status: "finalized" as const,
          subtotal: rec.total_spent,
          discount_amount: 0,
          public_discount_amount: 0,
          total_amount: rec.total_spent,
          advance_paid: 0,
          amount_due: rec.total_spent,
          points_redeemed: 0,
          created_at: rec.created_at,
          finalized_at: rec.created_at
        });

        paymentsToInsert.push({
          order_id: orderId,
          amount: rec.total_spent,
          method: "cash" as const,
          status: "completed" as const,
          created_at: rec.created_at
        });
      }
    }

    // 4. Execute DB operations in batches
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

    return NextResponse.json({
      success: true,
      locationAssigned: gamehausLoc.name,
      importedProfiles: profilesToUpsert.length,
      createdOrders: ordersToInsert.length,
      createdPayments: paymentsToInsert.length
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
