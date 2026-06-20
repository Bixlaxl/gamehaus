import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Sends a booking confirmation WhatsApp message via Meta Cloud API using location-based templates.
 * 
 * Templates:
 * - Gamehaus locations (slug: 'gamehaus') -> gamehaus_booking_confirmation
 * - Nerf Turf locations (slug: 'nerf-turf') -> nerfturf_booking_confirmation
 * 
 * Body Parameters Mapping:
 * 1. Customer Name (e.g. John)
 * 2. Booking Reference ID (e.g. GH-E2A91F or NT-B5D21E)
 * 3. Booking Date (e.g. 20 June 2026)
 * 4. Table/Resource + Time Slot (e.g. American Pool Table (2-3PM))
 * 5. Amount Paid (e.g. 1200)
 */
export async function sendWhatsAppConfirmation(orderId: string): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.warn(
      `[WhatsApp] Skipped sending confirmation for order ${orderId} because WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing.`
    );
    return false;
  }

  try {
    const admin = createAdminClient();

    // 1. Fetch Order and Location details
    const { data: order, error: orderError } = await admin
      .from("orders")
      .select(`
        customer_name,
        customer_phone,
        advance_paid,
        location_id,
        created_at,
        locations (
          slug,
          timezone
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error(`[WhatsApp] Order ${orderId} not found or query error:`, orderError);
      return false;
    }

    if (!order.customer_phone) {
      console.warn(`[WhatsApp] Skipped sending for order ${orderId}: no customer phone number.`);
      return false;
    }

    // 2. Fetch active booking items for this order
    const { data: items, error: itemsError } = await admin
      .from("order_items")
      .select(`
        scheduled_start,
        scheduled_end,
        tables (
          name
        )
      `)
      .eq("order_id", orderId)
      .eq("is_deleted", false)
      .not("scheduled_start", "is", null)
      .not("scheduled_end", "is", null);

    if (itemsError || !items || items.length === 0) {
      console.error(`[WhatsApp] No valid booking items found for order ${orderId} or query error:`, itemsError);
      return false;
    }

    // Extract location slug and timezone
    // locations is a single object since orders -> locations is one-to-many (or zero/one-to-many)
    const locationInfo = order.locations as unknown as { slug: string; timezone: string } | null;
    const slug = locationInfo?.slug || "gamehaus";
    const timezone = locationInfo?.timezone || "Asia/Kolkata";

    // 3. Prepare parameters
    // Parameter 1: Customer Name
    const customerName = order.customer_name || "Valued Customer";

    // Count how many orders were created at this location on or before this order
    const { count } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("location_id", order.location_id)
      .lte("created_at", order.created_at);

    // Parameter 2: Reference Code (e.g. GM001 or NT001)
    const prefix = slug === "nerf-turf" ? "NT" : "GM";
    const seqStr = String(count || 1).padStart(3, "0");
    const refCode = `${prefix}${seqStr}`;

    // Format booking date (using the first item's scheduled start date)
    const firstItem = items[0];
    const dateObj = new Date(firstItem.scheduled_start!);
    
    // Parameter 3: Booking Date (e.g., "20 June 2026")
    const day = dateObj.toLocaleDateString("en-US", { day: "numeric", timeZone: timezone });
    const month = dateObj.toLocaleDateString("en-US", { month: "long", timeZone: timezone });
    const year = dateObj.toLocaleDateString("en-US", { year: "numeric", timeZone: timezone });
    const formattedDate = `${day} ${month} ${year}`;

    // Parameter 4: Table/Resource + Time Slot (e.g., "American Pool Table (2-3PM)")
    const formatTimeSlot = (startStr: string, endStr: string, tz: string): string => {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const formatTime = (d: Date) => {
        let str = d.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "numeric",
          hour12: true,
          timeZone: tz,
        });
        str = str.replace(/\s+/g, ""); // e.g. "2:00 PM" -> "2:00PM"
        str = str.replace(/:00(AM|PM)$/i, "$1"); // e.g. "2:00PM" -> "2PM"
        return str;
      };
      return `${formatTime(start)}-${formatTime(end)}`;
    };

    // Combine multiple tables/slots if multiple tables are booked under the same order
    const itemStrings = items.map((item) => {
      const tableName = (item.tables as unknown as { name: string } | null)?.name || "Table";
      const slot = formatTimeSlot(item.scheduled_start!, item.scheduled_end!, timezone);
      return `${tableName} (${slot})`;
    });
    const resourceAndTime = itemStrings.join(", ");

    // Parameter 5: Amount Paid
    const amountPaid = Math.round(order.advance_paid).toString();

    // Determine template name based on location slug
    const templateName = slug === "nerf-turf" ? "nerfturf_booking_confirmation" : "gamehaus_booking_confirmation";

    // Clean phone number: remove non-digits, prepend "91" if exactly 10 digits
    let cleanedPhone = order.customer_phone.replace(/\D/g, "");
    if (cleanedPhone.length === 10) {
      cleanedPhone = "91" + cleanedPhone;
    }

    // 5. Construct payload
    const payload = {
      messaging_product: "whatsapp",
      to: cleanedPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: customerName },
              { type: "text", text: refCode },
              { type: "text", text: formattedDate },
              { type: "text", text: resourceAndTime },
              { type: "text", text: amountPaid },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [
              { type: "text", text: orderId },
            ],
          },
        ],
      },
    };

    console.log(`[WhatsApp] Sending template '${templateName}' to '${cleanedPhone}' for order '${refCode}'...`);
    
    // 6. Submit POST to Meta Graph API
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    if (!response.ok) {
      console.error(`[WhatsApp] Failed to send message. Meta API response status: ${response.status}`, responseText);
      return false;
    }

    console.log(`[WhatsApp] Confirmation message sent successfully. Response:`, responseText);
    return true;
  } catch (error) {
    console.error(`[WhatsApp] Unexpected error during notification sending:`, error);
    return false;
  }
}
