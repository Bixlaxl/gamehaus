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
      // Strip any non-digit characters
      phone = phone.replace(/\D/g, "");
      // If it starts with 91 and has 12 digits (Indian country code prefix), strip the 91
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

    // Deduplicate records by phone number (keeping the latest occurrence)
    const uniqueMap = new Map();
    for (const rec of records) {
      uniqueMap.set(rec.phone, rec);
    }
    const deduplicatedRecords = Array.from(uniqueMap.values());

    const admin = createAdminClient();
    const batchSize = 100;
    let successfulUpserts = 0;

    for (let i = 0; i < deduplicatedRecords.length; i += batchSize) {
      const batch = deduplicatedRecords.slice(i, i + batchSize);
      const { error } = await admin
        .from("customer_profiles")
        .upsert(batch, { onConflict: "phone" });

      if (error) {
        console.error(`Error in batch ${i}:`, error.message);
        return NextResponse.json({ 
          success: false, 
          error: error.message,
          batchSample: batch.slice(0, 3)
        });
      } else {
        successfulUpserts += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      totalParsed: records.length,
      totalUnique: deduplicatedRecords.length,
      imported: successfulUpserts,
      sample: deduplicatedRecords.slice(0, 3)
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message });
  }
}
