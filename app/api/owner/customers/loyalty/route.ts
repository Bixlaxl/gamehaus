import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });
    }

    const { data: viewer } = await supabase
      .from("users")
      .select("role")
      .eq("id", session.user.id)
      .single();

    if (!viewer || viewer.role !== "owner") {
      return NextResponse.json(err("Forbidden", "FORBIDDEN"), { status: 403 });
    }

    const body = await request.json();
    const { customerId, phone, points } = body;

    const pointsNum = parseInt(points, 10);
    if (isNaN(pointsNum) || pointsNum < 0) {
      return NextResponse.json(
        err("Points balance must be a valid non-negative integer", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    if (!customerId && !phone) {
      return NextResponse.json(
        err("Either customerId or phone is required", "VALIDATION_ERROR"),
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    let query = admin.from("customer_profiles").update({ points_balance: pointsNum });

    if (customerId) {
      query = query.eq("id", customerId);
    } else {
      query = query.eq("phone", phone);
    }

    const { data, error } = await query.select().single();

    if (error) {
      return NextResponse.json(err(error.message, "DB_ERROR"), { status: 500 });
    }

    return NextResponse.json(ok(data));
  } catch (error: any) {
    return NextResponse.json(err(error?.message || "Internal server error", "INTERNAL_ERROR"), {
      status: 500,
    });
  }
}
