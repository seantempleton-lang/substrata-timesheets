import { NextResponse } from "next/server";

import { getDb, isDatabaseConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        message: "DATABASE_URL is not configured.",
      },
      { status: 503 },
    );
  }

  try {
    const db = getDb();

    const [connection] = await db.unsafe<Array<{ now_utc: string; current_database: string }>>(
      `
        select
          now() at time zone 'utc' as now_utc,
          current_database() as current_database
      `,
    );

    const [counts] = await db.unsafe<
      Array<{ active_users: string; active_jobs: string; weekly_timesheets: string }>
    >(
      `
        select
          (select count(*)::text from app_users where is_active = true) as active_users,
          (select count(*)::text from jobs where status in ('approved', 'active', 'on_hold')) as active_jobs,
          (select count(*)::text from timesheets) as weekly_timesheets
      `,
    );

    const [authTables] = await db.unsafe<
      Array<{
        mobile_auth_accounts_table: string | null;
        mobile_auth_sessions_table: string | null;
      }>
    >(
      `
        select
          to_regclass('public.mobile_auth_accounts')::text as mobile_auth_accounts_table,
          to_regclass('public.mobile_auth_sessions')::text as mobile_auth_sessions_table
      `,
    );

    const mobileAuthAccountsReady = Boolean(authTables?.mobile_auth_accounts_table);
    const mobileAuthSessionsReady = Boolean(authTables?.mobile_auth_sessions_table);
    const authCounts = {
      activeMobileAuthAccounts: 0,
      linkedActiveMobileAuthAccounts: 0,
      activeMobileAuthSessions: 0,
    };

    if (mobileAuthAccountsReady) {
      const [mobileAuthCounts] = await db.unsafe<
        Array<{ active_mobile_auth_accounts: string; linked_active_mobile_auth_accounts: string }>
      >(
        `
          select
            (select count(*)::text from mobile_auth_accounts where is_active = true) as active_mobile_auth_accounts,
            (
              select count(*)::text
              from mobile_auth_accounts maa
              join app_users au on au.id = maa.user_id
              where maa.is_active = true
                and au.is_active = true
            ) as linked_active_mobile_auth_accounts
        `,
      );

      authCounts.activeMobileAuthAccounts = Number(mobileAuthCounts?.active_mobile_auth_accounts ?? 0);
      authCounts.linkedActiveMobileAuthAccounts = Number(
        mobileAuthCounts?.linked_active_mobile_auth_accounts ?? 0,
      );
    }

    if (mobileAuthSessionsReady) {
      const [mobileSessionCounts] = await db.unsafe<Array<{ active_mobile_auth_sessions: string }>>(
        `
          select count(*)::text as active_mobile_auth_sessions
          from mobile_auth_sessions
          where revoked_at is null
            and expires_at > now()
        `,
      );

      authCounts.activeMobileAuthSessions = Number(mobileSessionCounts?.active_mobile_auth_sessions ?? 0);
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      database: connection?.current_database ?? null,
      nowUtc: connection?.now_utc ?? null,
      counts: {
        activeUsers: Number(counts?.active_users ?? 0),
        activeJobs: Number(counts?.active_jobs ?? 0),
        timesheets: Number(counts?.weekly_timesheets ?? 0),
        ...authCounts,
      },
      auth: {
        mobileAuthAccountsTableReady: mobileAuthAccountsReady,
        mobileAuthSessionsTableReady: mobileAuthSessionsReady,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        message: error instanceof Error ? error.message : "Failed to connect to Postgres.",
      },
      { status: 500 },
    );
  }
}
