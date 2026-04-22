import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { clearAuthSessionCookie, revokeAuthSession, sessionCookieName } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (token) {
    await revokeAuthSession(token);
  }

  await clearAuthSessionCookie();

  return NextResponse.json({ ok: true });
}
