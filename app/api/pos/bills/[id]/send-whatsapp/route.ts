import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppInvoice } from "@/lib/whatsapp";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  try {
    const result = await sendWhatsAppInvoice(orderId);
    return NextResponse.json(ok(result));
  } catch (e: any) {
    return NextResponse.json(err(e?.message || "Failed to send WhatsApp bill", "SEND_ERROR"), { status: 500 });
  }
}
