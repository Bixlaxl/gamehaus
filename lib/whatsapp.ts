import { createAdminClient } from "@/lib/supabase/admin";
import { getAppSettings } from "@/lib/settings";

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
        subtotal,
        total_amount,
        advance_paid,
        discount_amount,
        points_redeemed,
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
        selected_mode_name,
        tables (
          name,
          type,
          modes
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

    // Calculate total cost of order items (fallback to live sum if subtotal column is null)
    const itemsTotalCost = items.reduce((sum, item) => {
      const start = new Date(item.scheduled_start!);
      const end = new Date(item.scheduled_end!);
      const hrs = (end.getTime() - start.getTime()) / (3600 * 1000);
      const itemRate = Number(item.rate_per_hour) || 0;
      return sum + (itemRate * hrs);
    }, 0);

    const roundedTotalCost = (order.subtotal !== null && order.subtotal !== undefined)
      ? Math.round(Number(order.subtotal))
      : Math.round(itemsTotalCost);

    // Fetch active settings for the loyalty point redemption rate
    const settings = await getAppSettings(admin);
    const pointsRedeemed = Number(order.points_redeemed) || 0;
    const redeemRate = settings.loyalty.redeem_rupees_per_point;
    const pointsDiscountVal = pointsRedeemed * redeemRate;

    const amountPaidVal = Math.round(order.advance_paid);
    const discountVal = Math.round(Number(order.discount_amount) || 0);
    const totalDiscountVal = discountVal + pointsDiscountVal;
    const netCost = Math.max(0, roundedTotalCost - totalDiscountVal);
    
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

    // Parameter 2: Reference Code (e.g. GM001 or NT-001)
    const seqStr = String(count || 1).padStart(3, "0");
    const refCode = slug === "nerf-turf" ? `NT-${seqStr}` : `GM${seqStr}`;

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
      const tableObj = item.tables as unknown as { name: string; type?: string; modes?: any[] } | null;
      const tableName = tableObj?.name || "Table";
      let modeName = item.selected_mode_name;
      
      if (!modeName && tableObj?.modes && Array.isArray(tableObj.modes) && tableObj.modes.length > 0) {
        const matched = tableObj.modes.find((m: any) => m.hourly_rate === item.rate_per_hour || (m.people_pricing && Object.values(m.people_pricing).includes(item.rate_per_hour)));
        if (matched) modeName = matched.name;
      }
      
      const modeBracket = modeName ? ` (${modeName.replace(/ Mode$/i, "")})` : "";
      const slot = formatTimeSlot(item.scheduled_start!, item.scheduled_end!, timezone);
      return `${tableName}${modeBracket} (${slot})`;
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

/**
 * Sends a booking cancellation WhatsApp message via Meta Cloud API using location-based templates.
 * 
 * Templates:
 * - Gamehaus locations (slug: 'gamehaus') -> gamehaus_booking_cancellation
 * - Nerf Turf locations (slug: 'nerf-turf') -> nerfturf_booking_cancellation
 * 
 * Body Parameters Mapping:
 * 1. Customer Name (e.g. John)
 * 2. Booking Reference ID (e.g. GM001 or NT-001)
 * 3. Refund Percentage (e.g. 100%)
 * 4. Refund Amount (e.g. 250)
 */
export async function sendWhatsAppCancellation(
  orderId: string,
  refundPct: number,
  refundAmount: number
): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.warn(
      `[WhatsApp] Skipped sending cancellation for order ${orderId} because WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID is missing.`
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
        location_id,
        created_at,
        locations (
          slug
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      console.error(`[WhatsApp] Order ${orderId} not found or query error:`, orderError);
      return false;
    }

    if (!order.customer_phone) {
      console.warn(`[WhatsApp] Skipped sending cancellation for order ${orderId}: no customer phone number.`);
      return false;
    }

    const locationInfo = order.locations as unknown as { slug: string } | null;
    const slug = locationInfo?.slug || "gamehaus";

    // Count how many orders were created at this location on or before this order
    const { count } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("location_id", order.location_id)
      .lte("created_at", order.created_at);

    // Reference Code (e.g. GM001 or NT-001)
    const seqStr = String(count || 1).padStart(3, "0");
    const refCode = slug === "nerf-turf" ? `NT-${seqStr}` : `GM${seqStr}`;

    const customerName = order.customer_name || "Valued Customer";

    // Clean phone number: remove non-digits, prepend "91" if exactly 10 digits
    let cleanedPhone = order.customer_phone.replace(/\D/g, "");
    if (cleanedPhone.length === 10) {
      cleanedPhone = "91" + cleanedPhone;
    }

    const templateName = slug === "nerf-turf" ? "nerfturf_booking_cancellation" : "gamehaus_booking_cancellation";

    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: customerName },
          { type: "text", text: refCode },
          { type: "text", text: refundPct.toString() },
          { type: "text", text: refundAmount.toString() },
        ],
      }
    ];

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

    console.log(`[WhatsApp] Sending cancellation template '${templateName}' to '${cleanedPhone}' for order '${refCode}'...`);

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
      console.error(`[WhatsApp] Failed to send cancellation message. Meta API response status: ${response.status}`, responseText);
      return false;
    }

    console.log(`[WhatsApp] Cancellation message sent successfully. Response:`, responseText);
    return true;
  } catch (error) {
    console.error(`[WhatsApp] Unexpected error during cancellation notification sending:`, error);
    return false;
  }
}

/**
 * Send digital bill / invoice WhatsApp message for a finalized order.
 * Returns both API status and a wa.me pre-filled fallback URL so staff can send via click-to-chat if desired.
 */
export async function sendWhatsAppInvoice(orderId: string): Promise<{ success: boolean; billUrl: string; waMeUrl: string }> {
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select(`
      *,
      locations(name, slug, timezone),
      items:order_items(
        id,
        actual_start,
        actual_end,
        scheduled_start,
        scheduled_end,
        rate_per_hour,
        free_hours_to_redeem,
        tables(name, type)
      )
    `)
    .eq("id", orderId)
    .single();

  if (!order || !order.customer_phone) {
    throw new Error("Order or customer phone number not found");
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://gamehaus.vercel.app";
  const billUrl = `${baseUrl}/bill/${orderId}`;
  
  let cleanedPhone = order.customer_phone.replace(/\D/g, "");
  if (cleanedPhone.length === 10) cleanedPhone = "91" + cleanedPhone;

  const customerName = order.customer_name || "Valued Customer";
  const totalPaid = Math.round((Number(order.advance_paid) || 0) + (Number(order.amount_due) || 0));
  const locationName = (order.locations as any)?.name || "Gamehaus";
  const slug = (order.locations as any)?.slug || "gamehaus";
  const timezone = (order.locations as any)?.timezone || "Asia/Kolkata";

  const messageText = `Hello ${customerName},\n\nThank you for visiting ${locationName}! 🎮\n\nTotal Amount: ₹${totalPaid}\n\nView & Download your Digital Bill PDF here:\n${billUrl}\n\nSee you again soon! 🎱`;
  const waMeUrl = `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(messageText)}`;

  // Determine membership details
  const isMemberSession = !!order.membership_id;
  const items = (order.items as any[]) || [];
  const freeHrsUsed = items.reduce((sum: number, item: any) => sum + (Number(item.free_hours_to_redeem) || 0), 0);
  const isFreeHrsSession = isMemberSession && freeHrsUsed > 0;

  let membership: any = null;
  if (isMemberSession) {
    const { data } = await admin
      .from("customer_memberships")
      .select("*, plan:membership_plans(*)")
      .eq("id", order.membership_id as string)
      .maybeSingle();
    membership = data;
  }

  // Format table names
  const tableNames = items
    .map((item: any) => item.tables?.name || "Table")
    .filter((val, index, self) => self.indexOf(val) === index)
    .join(", ") || "Gaming Session";

  // Format timeslot
  const formatTime = (d: Date, tz: string) => {
    let str = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "numeric",
      hour12: true,
      timeZone: tz,
    });
    return str.toLowerCase();
  };

  const timeslots = items
    .map((item: any) => {
      const start = item.actual_start || item.scheduled_start;
      const end = item.actual_end || item.expected_end || item.scheduled_end;
      if (!start || !end) return "";
      return `${formatTime(new Date(start), timezone)} – ${formatTime(new Date(end), timezone)}`;
    })
    .filter(Boolean)
    .filter((val, index, self) => self.indexOf(val) === index)
    .join(", ") || "Session";

  const expiryDate = membership?.expires_at
    ? new Date(membership.expires_at).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: timezone,
      })
    : "N/A";

  // Attempt Meta Cloud API send if configured
  let apiSuccess = false;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (accessToken && phoneNumberId) {
    try {
      let templateName = "";
      let hasHeaderVar = false;
      let bodyParams: { type: string; text: string }[] = [];

      if (isFreeHrsSession) {
        templateName = slug === "nerf-turf" ? "nerfturf_member_session_hours" : "gamehaus_member_session_hours";
        hasHeaderVar = true;
        
        const remainingHrs = Object.values(membership?.free_hours_ledger || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);

        bodyParams = [
          { type: "text", text: tableNames },
          { type: "text", text: timeslots },
          { type: "text", text: freeHrsUsed.toString() },
          { type: "text", text: remainingHrs.toString() },
          { type: "text", text: expiryDate },
        ];
      } else if (isMemberSession) {
        templateName = slug === "nerf-turf" ? "nerfturf_member_session_discount" : "gamehaus_member_session_discount";
        hasHeaderVar = true;

        const savedAmount = Math.max(0, Math.round((Number(order.discount_amount) - (Number(order.public_discount_amount) || 0)) * 100) / 100);

        bodyParams = [
          { type: "text", text: tableNames },
          { type: "text", text: timeslots },
          { type: "text", text: savedAmount.toString() },
          { type: "text", text: expiryDate },
        ];
      } else {
        templateName = slug === "nerf-turf" ? "nerfturf_invoice" : "gamehaus_invoice";
        hasHeaderVar = false;

        bodyParams = [
          { type: "text", text: customerName },
          { type: "text", text: order.id.slice(0, 8).toUpperCase() },
          { type: "text", text: totalPaid.toString() },
          { type: "text", text: billUrl },
        ];
      }

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanedPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            ...(hasHeaderVar ? [
              {
                type: "header",
                parameters: [
                  { type: "text", text: customerName }
                ]
              }
            ] : []),
            {
              type: "body",
              parameters: bodyParams,
            },
          ],
        },
      };

      const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      apiSuccess = response.ok;
      if (!response.ok) {
        console.error("[WhatsApp send error]", await response.text());
      }
    } catch (e) {
      console.error("[WhatsApp Invoice API error]", e);
    }
  }

  return { success: apiSuccess, billUrl, waMeUrl };
}

