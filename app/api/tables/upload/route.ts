import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, err } from "@/lib/validators/schemas";

export const runtime = 'edge';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json(err("Unauthorized", "UNAUTHORIZED"), { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const tableId = formData.get("tableId") as string | null;
  const locationId = formData.get("locationId") as string | null;

  if (!file || !tableId || !locationId) {
    return NextResponse.json(err("Missing file, tableId, or locationId", "VALIDATION_ERROR"), { status: 400 });
  }

  const fileId = crypto.randomUUID();
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${locationId}/${tableId}/${fileId}.${ext}`;
  const bytes = await file.arrayBuffer();
  const buffer = new Uint8Array(bytes);

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("table-images")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (error) return NextResponse.json(err(error.message, "STORAGE_ERROR"), { status: 500 });

  const { data } = admin.storage.from("table-images").getPublicUrl(path);
  return NextResponse.json(ok({ url: data.publicUrl }));
}
