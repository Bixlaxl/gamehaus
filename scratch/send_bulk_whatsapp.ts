import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

// Load environment variables manually from .env.local
const envContent = fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf-8") : "";
const processEnv: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    processEnv[key] = val;
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || processEnv.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || processEnv.SUPABASE_SERVICE_ROLE_KEY;

// WhatsApp Credentials from the user's input
const WHATSAPP_ACCESS_TOKEN = "EAGC8jgrZCtwgBR685IGivPbH0zovCsvZAyWSxXIWtNh3ffLHIS4MFR7WAeMI1NAcLZBH1qkQO5sCOtRvoING8d8VgRrZB3gT97gaKtjOsVg9dpiADk1rNZAyg1FjlN2p4OLOT3SEGZA2a4e8WKWCbThrFqAQutpnk3qchZCO0EZA7ObqpZADMhXpjHTd7VOZAk9gZDZD";
const WHATSAPP_PHONE_NUMBER_ID = "1217928801397537";
const TEMPLATE_NAME = "gamehaus_open_till_3";
const MEDIA_ID = "907036948319389";

async function main() {
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    console.log("Parsed keys:", Object.keys(processEnv));
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Fetching customer profiles...");
  
  // Retrieve all profiles in chunks of 1000
  let profiles: { name: string | null; phone: string }[] = [];
  let offset = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("customer_profiles")
      .select("name, phone")
      .range(offset, offset + size - 1);
    if (error) {
      console.error("Failed to fetch customer profiles:", error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    profiles = profiles.concat(data);
    if (data.length < size) break;
    offset += size;
  }

  // Validate phone numbers (must be 10 digits start with 6-9)
  const phonePattern = /^[6-9]\d{9}$/;
  const validCustomers = profiles.filter((p) => phonePattern.test(p.phone));

  console.log(`\nFound ${profiles.length} total customer profiles.`);
  console.log(`Found ${validCustomers.length} profiles with valid 10-digit Indian numbers.\n`);

  if (validCustomers.length === 0) {
    console.log("No valid phone numbers found. Exiting.");
    process.exit(0);
  }

  // Double check confirmation
  console.log("--------------------------------------------------------------------");
  console.log(`WARNING: This will send ${validCustomers.length} WhatsApp messages.`);
  console.log(`Template: "${TEMPLATE_NAME}"`);
  console.log(`Media ID: "${MEDIA_ID}"`);
  console.log("--------------------------------------------------------------------");
  console.log("Starting broadcast in 5 seconds...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const results = {
    success: [] as string[],
    failed: [] as { phone: string; name: string | null; error: string }[],
  };

  const delayMs = 60; // ~16 messages per second (safe rate limit)

  for (let i = 0; i < validCustomers.length; i++) {
    const customer = validCustomers[i];
    const formattedPhone = `91${customer.phone}`;
    
    console.log(`[${i + 1}/${validCustomers.length}] Sending to ${customer.name || "Customer"} (${customer.phone})...`);

    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: formattedPhone,
          type: "template",
          template: {
            name: TEMPLATE_NAME,
            language: {
              code: "en",
            },
            components: [
              {
                type: "header",
                parameters: [
                  {
                    type: "image",
                    image: {
                      id: MEDIA_ID,
                    },
                  },
                ],
              },
            ],
          },
        }),
      });

      const body = await res.json();
      if (res.ok && body.messages) {
        results.success.push(customer.phone);
        console.log(`  └ ✅ Success: ${body.messages[0].id}`);
      } else {
        const errMsg = body.error?.message || "Unknown error";
        results.failed.push({ phone: customer.phone, name: customer.name, error: errMsg });
        console.error(`  └ ❌ Failed: ${errMsg}`);
      }
    } catch (e: any) {
      results.failed.push({ phone: customer.phone, name: customer.name, error: e?.message || "Fetch error" });
      console.error(`  └ ❌ Fetch Exception: ${e?.message}`);
    }

    // Wait to stay within rate limit
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  console.log("\n==================================================");
  console.log("Broadcast Completed!");
  console.log(`Success: ${results.success.length}`);
  console.log(`Failed: ${results.failed.length}`);
  console.log("==================================================");

  if (results.failed.length > 0) {
    fs.writeFileSync("failed_whatsapp_sends.json", JSON.stringify(results.failed, null, 2));
    console.log("Failed list saved to 'failed_whatsapp_sends.json'");
  }
}

main();
