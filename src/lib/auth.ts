import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { cookies } from "next/headers";

import { getDb, isDatabaseConfigured } from "@/lib/db";
import type { EmployeeOption } from "@/lib/types";

const scrypt = promisify(scryptCallback);
export const sessionCookieName = "substrata_timesheet_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

type AuthAccountRow = {
  account_id: string;
  user_id: string;
  login_email: string;
  password_hash: string;
  employee_code: string;
  full_name: string;
  initials: string;
  role_title: string;
  email: string | null;
  division: string | null;
  region: string | null;
};

function mapEmployee(row: Omit<AuthAccountRow, "account_id" | "login_email" | "password_hash">): EmployeeOption {
  return {
    id: row.user_id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    initials: row.initials,
    roleTitle: row.role_title,
    email: row.email ?? undefined,
    division: row.division ?? undefined,
    region: row.region ?? undefined,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !expectedHex) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}

export async function getAuthAccountByEmail(email: string): Promise<AuthAccountRow | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const db = getDb();
  const [row] = await db.unsafe<AuthAccountRow[]>(
    `
      select
        maa.id::text as account_id,
        au.id::text as user_id,
        maa.login_email,
        maa.password_hash,
        au.employee_code,
        au.full_name,
        au.initials,
        au.role_title,
        au.email,
        au.division,
        au.region
      from mobile_auth_accounts maa
      join app_users au on au.id = maa.user_id
      where maa.is_active = true
        and au.is_active = true
        and lower(maa.login_email) = lower($1::text)
      limit 1
    `,
    [email],
  );

  return row ?? null;
}

export async function createAuthSession(accountId: string) {
  const db = getDb();
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);

  await db.unsafe(
    `
      insert into mobile_auth_sessions (
        account_id,
        session_token_hash,
        expires_at
      ) values (
        $1::uuid,
        $2::text,
        now() + interval '30 days'
      )
    `,
    [accountId, tokenHash],
  );

  await db.unsafe(
    `
      update mobile_auth_accounts
      set
        last_login_at = now(),
        updated_at = now()
      where id = $1::uuid
    `,
    [accountId],
  );

  return {
    token: rawToken,
    maxAgeSeconds: sessionMaxAgeSeconds,
  };
}

export async function setAuthSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
}

export async function clearAuthSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeAuthSession(token: string) {
  if (!isDatabaseConfigured()) {
    return;
  }

  const db = getDb();
  await db.unsafe(
    `
      update mobile_auth_sessions
      set revoked_at = now()
      where session_token_hash = $1::text
        and revoked_at is null
    `,
    [hashSessionToken(token)],
  );
}

export async function getCurrentEmployee(): Promise<EmployeeOption | null> {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;

  if (!token) {
    return null;
  }

  const db = getDb();
  const [row] = await db.unsafe<
    Array<{
      account_id: string;
      user_id: string;
      employee_code: string;
      full_name: string;
      initials: string;
      role_title: string;
      email: string | null;
      division: string | null;
      region: string | null;
    }>
  >(
    `
      select
        maa.id::text as account_id,
        au.id::text as user_id,
        au.employee_code,
        au.full_name,
        au.initials,
        au.role_title,
        au.email,
        au.division,
        au.region
      from mobile_auth_sessions mas
      join mobile_auth_accounts maa on maa.id = mas.account_id
      join app_users au on au.id = maa.user_id
      where mas.session_token_hash = $1::text
        and mas.revoked_at is null
        and mas.expires_at > now()
        and maa.is_active = true
        and au.is_active = true
      limit 1
    `,
    [hashSessionToken(token)],
  );

  if (!row) {
    return null;
  }

  await db.unsafe(
    `
      update mobile_auth_sessions
      set last_seen_at = now()
      where session_token_hash = $1::text
    `,
    [hashSessionToken(token)],
  );

  return mapEmployee({
    user_id: row.user_id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    initials: row.initials,
    role_title: row.role_title,
    email: row.email,
    division: row.division,
    region: row.region,
  });
}
