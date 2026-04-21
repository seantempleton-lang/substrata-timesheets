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

    return NextResponse.json({
      ok: true,
      configured: true,
      database: connection?.current_database ?? null,
      nowUtc: connection?.now_utc ?? null,
      counts: {
        activeUsers: Number(counts?.active_users ?? 0),
        activeJobs: Number(counts?.active_jobs ?? 0),
        timesheets: Number(counts?.weekly_timesheets ?? 0),
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
