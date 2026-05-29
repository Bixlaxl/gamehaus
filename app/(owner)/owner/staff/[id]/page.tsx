export const runtime = "edge";

import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { StaffDetailContent, type StaffDetailData } from "./content";

/**
 * Server-fetch wrapper. Reuses the /api/staff/[id]/profile endpoint so the
 * authorization story stays in exactly one place (the endpoint itself
 * enforces owner-only access).
 */
async function fetchProfile(id: string): Promise<StaffDetailData | null> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const cookie = h.get("cookie") ?? "";

  const res = await fetch(`${proto}://${host}/api/staff/${id}/profile`, {
    cache: "no-store",
    headers: { cookie },
  });
  if (!res.ok) return null;
  const body = await res.json() as { success: boolean; data?: StaffDetailData; error?: string };
  if (!body.success || !body.data) return null;
  return body.data;
}

export default async function StaffDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchProfile(id);
  if (!data) notFound();
  return <StaffDetailContent initial={data} staffId={id} />;
}
