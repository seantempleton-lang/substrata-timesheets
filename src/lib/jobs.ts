import { cache } from "react";

import { getDb, isDatabaseConfigured } from "@/lib/db";
import { getDefaultBootstrap } from "@/lib/timesheets";
import type { AppBootstrap, EmployeeOption, JobOption } from "@/lib/types";

export const getAppBootstrap = cache(async (): Promise<AppBootstrap> => {
  if (!isDatabaseConfigured()) {
    return getDefaultBootstrap();
  }

  try {
    const jobs = await listJobs();

    return {
      jobs,
      databaseReady: true,
      mode: "live",
      message: "Connected",
    };
  } catch (error) {
    return {
      ...getDefaultBootstrap(),
      message:
        error instanceof Error
          ? `Database connection failed, so the app has fallen back to demo jobs. ${error.message}`
          : "Database connection failed, so the app has fallen back to demo jobs.",
    };
  }
});

export async function getEmployeeByEmail(email: string): Promise<EmployeeOption | null> {
  const db = getDb();

  const [row] = await db.unsafe<
    Array<{
      id: string;
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
        id::text as id,
        employee_code,
        full_name,
        initials,
        role_title,
        email,
        division,
        region
      from app_users
      where is_active = true
        and lower(email) = lower($1::text)
      limit 1
    `,
    [email],
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    initials: row.initials,
    roleTitle: row.role_title,
    email: row.email ?? undefined,
    division: row.division ?? undefined,
    region: row.region ?? undefined,
  };
}

export async function listJobs(): Promise<JobOption[]> {
  const db = getDb();
  const activeStatuses = (
    process.env.MOBILE_JOB_ACTIVE_STATUSES ?? "approved,active,on_hold"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const rows = await db.unsafe<
    Array<{
      id: string;
      code: string | null;
      name: string | null;
      client_name: string | null;
      site_name: string | null;
    }>
  >(`
    select
      j.id::text as id,
      j.job_number::text as code,
      j.title::text as name,
      c.name::text as client_name,
      coalesce(j.site_name::text, j.site_address::text, 'Unknown site') as site_name
    from jobs j
    join clients c on c.id = j.client_id
    where j.status = any($1::text[])
    order by j.job_number asc
  `, [activeStatuses]);

  return rows.map((row) => ({
    id: row.id,
    code: row.code ?? row.id,
    name: row.name ?? "Unnamed project",
    clientName: row.client_name ?? "Unknown client",
    siteName: row.site_name ?? "Unknown site",
    isActive: true,
  }));
}
