import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Generate unique pass ID for manual / cash registrations
function generatePassId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `GH-POOL-${suffix}`;
}

// In-memory registration store fallback
const localRegistrations: Array<{
  id: string;
  name: string;
  phone: string;
  amount: number;
  status: "paid" | "unpaid";
  payment_id: string | null;
  razorpay_order_id: string | null;
  payment_method: string;
  pass_id: string;
  created_at: string;
}> = [];

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data: dbData, error } = await (admin
      .from("tournament_registrations" as any) as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && dbData && dbData.length > 0) {
      return NextResponse.json({ success: true, registrations: dbData, count: dbData.length });
    }
  } catch {
    // Fall back to local store
  }

  return NextResponse.json({
    success: true,
    registrations: localRegistrations,
    count: localRegistrations.length,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name,
      phone,
      payment_method = "cash",
      status = "paid",
      payment_id = null,
      razorpay_order_id = null,
    } = body;

    if (!name?.trim() || !phone?.trim()) {
      return NextResponse.json(
        { success: false, error: "Name and phone are required" },
        { status: 400 }
      );
    }

    const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    const passId = generatePassId();

    const newReg = {
      id: `reg-${Date.now()}`,
      name: name.trim(),
      phone: cleanPhone,
      amount: 400,
      status: status === "unpaid" ? "unpaid" : "paid",
      payment_id: payment_id || (status === "paid" ? `manual_${Date.now()}` : null),
      razorpay_order_id: razorpay_order_id || null,
      payment_method: payment_method || "cash",
      pass_id: passId,
      created_at: new Date().toISOString(),
    };

    try {
      const admin = createAdminClient();
      await (admin.from("tournament_registrations" as any) as any).insert([newReg]);
    } catch {
      // Ignore fallback
    }

    localRegistrations.unshift(newReg as any);

    return NextResponse.json({ success: true, registration: newReg });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, payment_method } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Participant ID required" }, { status: 400 });
    }

    const updateFields: Record<string, any> = {};
    if (status) updateFields.status = status;
    if (payment_method) updateFields.payment_method = payment_method;
    if (status === "paid") {
      updateFields.payment_id = `manual_pay_${Date.now()}`;
    }

    try {
      const admin = createAdminClient();
      await (admin.from("tournament_registrations" as any) as any)
        .update(updateFields)
        .eq("id", id);
    } catch {
      // Ignore fallback
    }

    const item = localRegistrations.find((r) => r.id === id);
    if (item) {
      if (status) item.status = status;
      if (payment_method) item.payment_method = payment_method;
      if (status === "paid" && !item.payment_id) {
        item.payment_id = `manual_pay_${Date.now()}`;
      }
    }

    return NextResponse.json({ success: true, updated: updateFields });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ success: false, error: "ID required" }, { status: 400 });
    }

    try {
      const admin = createAdminClient();
      await (admin.from("tournament_registrations" as any) as any).delete().eq("id", id);
    } catch {
      // Ignore fallback
    }

    const idx = localRegistrations.findIndex((r) => r.id === id);
    if (idx !== -1) localRegistrations.splice(idx, 1);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
