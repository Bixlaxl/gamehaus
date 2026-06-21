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
        discount_amount,
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
        rate_per_hour,
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
    const locationInfo = order.locations as unknown as { slug: string; timezone: string } | null;
    const slug = locationInfo?.slug || "gamehaus";
    const timezone = locationInfo?.timezone || "Asia/Kolkata";

    // Calculate total cost of order items
    const totalCost = items.reduce((sum, item) => {
      const start = new Date(item.scheduled_start!);
      const end = new Date(item.scheduled_end!);
      const hrs = (end.getTime() - start.getTime()) / (3600 * 1000);
      const itemRate = Number(item.rate_per_hour) || 0;
      return sum + (itemRate * hrs);
    }, 0);

    const roundedTotalCost = Math.round(totalCost);
    const amountPaidVal = Math.round(order.advance_paid);
    const discountVal = Math.round(Number(order.discount_amount) || 0);
    const netCost = roundedTotalCost - discountVal;
    
    // We consider it fully paid if the amount paid is at least the net cost (within a 1 rupee buffer)
    const isFullyPaid = amountPaidVal >= netCost - 1;
    const amountDueVal = Math.max(0, netCost - amountPaidVal);

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
        str = str.replace(/\s+/g, "");
        str = str.replace(/:00(AM|PM)$/i, "$1");
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

    // Clean phone number: remove non-digits, prepend "91" if exactly 10 digits
    let cleanedPhone = order.customer_phone.replace(/\D/g, "");
    if (cleanedPhone.length === 10) {
      cleanedPhone = "91" + cleanedPhone;
    }

    // 4. Select correct template and construct payload components
    let templateName = "";
    let parameters: { type: string; text: string }[] = [];

    if (isFullyPaid) {
      templateName = slug === "nerf-turf" ? "nerfturf_booking_confirmation" : "gamehaus_booking_confirmation";
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: refCode },
        { type: "text", text: formattedDate },
        { type: "text", text: resourceAndTime },
        { type: "text", text: amountPaidVal.toString() },
      ];
    } else {
      templateName = slug === "nerf-turf" ? "nerfturf_table_reservation" : "gamehaus_table_reservation";
      parameters = [
        { type: "text", text: customerName },
        { type: "text", text: refCode },
        { type: "text", text: formattedDate },
        { type: "text", text: resourceAndTime },
        { type: "text", text: amountPaidVal.toString() },
        { type: "text", text: amountDueVal.toString() },
      ];
    }

    const components: any[] = [
      {
        type: "body",
        parameters,
      }
    ];

    if (isFullyPaid) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [
          {
            type: "text",
            text: orderId,
          }
        ]
      });
    }

    // 5. Construct payload
    const payload = {
      messaging_product: "whatsapp",
      to: cleanedPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en" },
        components,
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
