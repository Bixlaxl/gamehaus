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

    if (!viewer || (viewer.role !== "owner" && viewer.role !== "staff")) {
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

    let updateRes;
    if (customerId) {
      updateRes = await admin
        .from("customer_profiles")
        .update({ points_balance: pointsNum })
        .eq("id", customerId)
        .select("id, phone, name, points_balance, visit_count, total_spent, last_visit_at");
    } else {
      updateRes = await admin
        .from("customer_profiles")
        .update({ points_balance: pointsNum })
        .eq("phone", phone)
        .select("id, phone, name, points_balance, visit_count, total_spent, last_visit_at");
    }

    if (updateRes.error) {
      return NextResponse.json(err(updateRes.error.message, "DB_ERROR"), { status: 500 });
    }

    const updatedRecord =
      updateRes.data && updateRes.data.length > 0
        ? updateRes.data[0]
        : { id: customerId, phone, points_balance: pointsNum };

    return NextResponse.json(ok(updatedRecord));
  } catch (error: any) {
    return NextResponse.json(err(error?.message || "Internal server error", "INTERNAL_ERROR"), {
      status: 500,
    });
  }
}
