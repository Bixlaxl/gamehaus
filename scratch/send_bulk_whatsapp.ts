/**
 * Bulk WhatsApp Broadcast — Gamehaus 8-Ball Pool Tournament
 * 
 * Target: Option B — Repeat Regulars (visit_count >= 2)
 * Template: gamehaus_8ball_tournament (English UK)
 * 
 * Run: npx tsx scratch/send_bulk_whatsapp.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Load .env.local ──────────────────────────────────────────────────────────
const envContent = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf-8") : "";
const processEnv: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    processEnv[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL  || processEnv.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY  || processEnv.SUPABASE_SERVICE_ROLE_KEY;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN      || processEnv.WHATSAPP_ACCESS_TOKEN     || "EAGC8jgrZCtwgBR685IGivPbH0zovCsvZAyWSxXIWtNh3ffLHIS4MFR7WAeMI1NAcLZBH1qkQO5sCOtRvoING8d8VgRrZB3gT97gaKtjOsVg9dpiADk1rNZAyg1FjlN2p4OLOT3SEGZA2a4e8WKWCbThrFqAQutpnk3qchZCO0EZA7ObqpZADMhXpjHTd7VOZAk9gZDZD";
const PHONE_ID     = process.env.WHATSAPP_PHONE_NUMBER_ID   || processEnv.WHATSAPP_PHONE_NUMBER_ID   || "1217928801397537";

// ── Config ───────────────────────────────────────────────────────────────────
const TEMPLATE_NAME  = "gamehaus_8ball_tournament";
const LANGUAGE_CODE  = "en_GB";                      // English (UK) as registered in Meta
const IMAGE_PATH     = path.resolve("image copy.png");
const DELAY_MS       = 80;                           // ~12 msg/sec — safe rate limit

// ── Step 1: Upload image to WhatsApp Media API ───────────────────────────────
async function uploadImage(): Promise<string> {
  console.log(`📤 Uploading ${IMAGE_PATH} to WhatsApp Media API...`);

  if (!fs.existsSync(IMAGE_PATH)) {
    throw new Error(`Image not found at: ${IMAGE_PATH}`);
  }

  const curlCmd = `curl -s -X POST "https://graph.facebook.com/v19.0/${PHONE_ID}/media" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -F "messaging_product=whatsapp" \
    -F "type=image/png" \
    -F "file=@${IMAGE_PATH};type=image/png"`;

  const output = execSync(curlCmd, { encoding: "utf-8" });
  const data = JSON.parse(output);

  if (!data.id) {
    throw new Error(`Media upload failed: ${JSON.stringify(data, null, 2)}`);
  }

  console.log(`✅ Image uploaded successfully. Media ID: ${data.id}\n`);
  return data.id as string;
}

// ── Step 2: Send one template message ────────────────────────────────────────
async function sendMessage(phone: string, mediaId: string): Promise<{ ok: boolean; msgId?: string; error?: string }> {
  const formattedPhone = `91${phone}`;

  const payload = {
    messaging_product: "whatsapp",
    to: formattedPhone,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: LANGUAGE_CODE },
      components: [
        {
          type: "header",
          parameters: [
            { type: "image", image: { id: mediaId } },
          ],
        },
      ],
    },
  };

  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json() as any;

  if (res.ok && body.messages?.[0]?.id) {
    return { ok: true, msgId: body.messages[0].id };
  }
  return { ok: false, error: body.error?.message || JSON.stringify(body) };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Fetch all customer profiles ──────────────────────────────────────────
  console.log("🔍 Fetching customer profiles from Supabase...");
  let profiles: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("name, phone, visit_count")
      .range(offset, offset + PAGE - 1);
    if (error) { console.error("DB error:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    profiles = profiles.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // ── Filter: Repeat Regulars (visit_count >= 2) ────────────────────────────
  const phonePattern = /^[6-9]\d{9}$/;
  const uniqueCustomersMap = new Map<string, { name: string | null; visits: number }>();

  let filteredOut = 0;
  for (const p of profiles) {
    const clean = p.phone?.replace(/\D/g, "").slice(-10);
    if (clean && phonePattern.test(clean)) {
      const visits = Number(p.visit_count || 0);
      if (visits >= 2) {
        if (!uniqueCustomersMap.has(clean)) {
          uniqueCustomersMap.set(clean, { name: p.name, visits });
        }
      } else {
        filteredOut++;
      }
    }
  }

  const targetCustomers = Array.from(uniqueCustomersMap.entries()).map(([phone, info]) => ({
    phone,
    name: info.name,
    visits: info.visits,
  }));

  console.log(`\n📊 Total profiles in database       : ${profiles.length}`);
  console.log(`🎯 Repeat regulars targeted (2+ visits): ${targetCustomers.length}`);
  console.log(`⏭️  Single-visit / 0-visit filtered out : ${filteredOut}\n`);

  if (targetCustomers.length === 0) {
    console.log("No matching repeat customers found. Exiting.");
    process.exit(0);
  }

  // ── Upload the image ─────────────────────────────────────────────────────
  let mediaId: string;
  try {
    mediaId = await uploadImage();
  } catch (err: any) {
    console.error("❌ Image upload failed:", err.message);
    process.exit(1);
  }

  // ── Confirmation prompt ──────────────────────────────────────────────────
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`🚀 STARTING BROADCAST — OPTION B (REPEAT REGULARS)`);
  console.log(`   Template   : ${TEMPLATE_NAME} (${LANGUAGE_CODE})`);
  console.log(`   Media ID   : ${mediaId}`);
  console.log(`   Recipients : ${targetCustomers.length} loyal repeat customers`);
  console.log(`   Rate       : 1 message every ${DELAY_MS}ms (~${Math.round(1000/DELAY_MS)}/sec)`);
  console.log(`   Est. time  : ~${((targetCustomers.length * DELAY_MS) / 60000).toFixed(1)} minutes`);
  console.log("══════════════════════════════════════════════════════════════");
  console.log("Starting in 3 seconds...\n");
  await new Promise(r => setTimeout(r, 3000));

  // ── Send ─────────────────────────────────────────────────────────────────
  const results = {
    success: [] as string[],
    failed: [] as { phone: string; name: string | null; error: string }[],
  };

  const startTime = Date.now();

  for (let i = 0; i < targetCustomers.length; i++) {
    const { phone, name, visits } = targetCustomers[i];
    const progress = `[${i + 1}/${targetCustomers.length}]`;
    process.stdout.write(`${progress} → 91${phone} (${name || "—"} | ${visits} visits) ... `);

    const result = await sendMessage(phone, mediaId);
    if (result.ok) {
      results.success.push(phone);
      console.log(`✅ ${result.msgId}`);
    } else {
      results.failed.push({ phone, name, error: result.error! });
      console.log(`❌ ${result.error}`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("📣 BROADCAST COMPLETE");
  console.log(`   ⏱️ Time taken: ${elapsedSec}s (~${(Number(elapsedSec)/60).toFixed(1)} mins)`);
  console.log(`   ✅ Sent      : ${results.success.length}`);
  console.log(`   ❌ Failed    : ${results.failed.length}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (results.failed.length > 0) {
    const failFile = "failed_tournament_blast.json";
    fs.writeFileSync(failFile, JSON.stringify(results.failed, null, 2));
    console.log(`⚠️  Failed list saved to '${failFile}' — review and retry manually.`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
