import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createAuthSession,
  getAuthAccountByEmail,
  setAuthSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured for live sign-in." },
        { status: 503 },
      );
    }

    const body = loginSchema.parse(await request.json());
    const account = await getAuthAccountByEmail(body.email);

    if (!account) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      );
    }

    const isValid = await verifyPassword(body.password, account.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 },
      );
    }

    const session = await createAuthSession(account.account_id);
    await setAuthSessionCookie(session.token);

    return NextResponse.json({
      ok: true,
      employee: {
        id: account.user_id,
        employeeCode: account.employee_code,
        fullName: account.full_name,
        initials: account.initials,
        roleTitle: account.role_title,
        email: account.email ?? undefined,
        division: account.division ?? undefined,
        region: account.region ?? undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to sign in.",
      },
      { status: 500 },
    );
  }
}
