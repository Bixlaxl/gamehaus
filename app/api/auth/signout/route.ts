export const runtime = "edge";
export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore signout errors on server client
  }

  const response = NextResponse.json({ success: true });

  // Explicitly expire and delete all Supabase auth cookies
  const allCookies = request.cookies.getAll();
  for (const cookie of allCookies) {
    if (cookie.name.startsWith("sb-") || cookie.name.includes("auth-token")) {
      response.cookies.set(cookie.name, "", {
        path: "/",
        maxAge: 0,
        expires: new Date(0),
      });
    }
  }

  return response;
}

export async function GET(request: NextRequest) {
  return POST(request);
}
