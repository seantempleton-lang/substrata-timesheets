import { getDb } from "@/lib/db";
import {
  addDaysToDateString,
  allocatePaidHoursAcrossEntries,
  APP_TIME_ZONE,
  getTodayInTimeZone,
  getWeekStartMonday,
  timesheetPayloadSchema,
} from "@/lib/timesheets";
import type {
  EntryType,
  TimesheetHistoryDay,
  TimesheetHistoryPeriod,
  TimesheetPayload,
} from "@/lib/types";

type TimesheetLookupRow = {
  existing_day_id: string | null;
};

type TimesheetHistoryRow = {
  week_start: string;
  week_end: string;
  timesheet_status: string | null;
  submitted_at: string | null;
  total_hours: string | null;
  total_overnights: number | null;
  work_date: string;
  day_type: "work" | "leave";
  leave_type: "annual" | "sick" | "unpaid" | null;
  overnight: boolean;
  day_notes: string | null;
  entry_hours: string | null;
  rate_type: string | null;
  entry_notes: string | null;
  start_time: string | null;
  end_time: string | null;
  job_code: string | null;
  job_name: string | null;
  client_name: string | null;
  site_name: string | null;
};

function getLeaveType(entryType: TimesheetPayload["entryType"]) {
  switch (entryType) {
    case "annual_leave":
      return "annual";
    case "sick_leave":
      return "sick";
    case "unpaid_leave":
      return "unpaid";
    default:
      return null;
  }
}

export async function createTimesheetEntry(input: TimesheetPayload) {
  const payload = timesheetPayloadSchema.parse({
    ...input,
    source: input.source ?? "mobile-web",
    submittedAt: input.submittedAt ?? new Date().toISOString(),
  });

  const db = getDb();

  return db.begin(async (transaction) => {
    const [user] = await transaction.unsafe<
      Array<{ id: string; full_name: string; employee_code: string }>
    >(
      `
        select id::text, full_name, employee_code
        from app_users
        where is_active = true
          and (
            ($1::uuid is not null and id = $1::uuid)
            or ($2::text is not null and employee_code = $2::text)
            or lower(full_name) = lower($3::text)
          )
        order by
          case
            when id = $1::uuid then 0
            when employee_code = $2::text then 1
            else 2
          end
        limit 1
      `,
      [payload.userId ?? null, payload.employeeCode ?? null, payload.employeeName],
    );

    if (!user) {
      throw new Error(
        "No active SubStrata user matched that employee code or name. Add the crew member to app_users first.",
      );
    }

    const leaveType = getLeaveType(payload.entryType);
    const dayType = payload.entryType === "work" ? "work" : "leave";

    const [timesheet] = await transaction.unsafe<Array<{ id: string; status: string }>>(
      `
        insert into timesheets (
          user_id,
          week_start,
          status,
          submitted_at,
          notes
        ) values (
          $1::uuid,
          date_trunc('week', $2::date)::date,
          $3::text,
          $4::timestamptz,
          $5::text
        )
        on conflict (user_id, week_start)
        do update set
          status = excluded.status,
          submitted_at = excluded.submitted_at,
          supervisor_approved_by = null,
          supervisor_approved_at = null,
          manager_approved_by = null,
          manager_approved_at = null,
          notes = coalesce(excluded.notes, timesheets.notes),
          updated_at = now()
        returning id::text, status
      `,
      [
        user.id,
        payload.workDate,
        process.env.MOBILE_TIMESHEET_STATUS ?? "submitted",
        payload.submittedAt ?? new Date().toISOString(),
        payload.notes ?? null,
      ],
    );

    const [existingDay] = await transaction.unsafe<TimesheetLookupRow[]>(
      `
        select id::text as existing_day_id
        from timesheet_days
        where timesheet_id = $1::uuid
          and work_date = $2::date
        limit 1
      `,
      [timesheet.id, payload.workDate],
    );

    const [timesheetDay] = await transaction.unsafe<Array<{ id: string }>>(
      `
        insert into timesheet_days (
          timesheet_id,
          work_date,
          day_type,
          leave_type,
          overnight,
          notes
        ) values (
          $1::uuid,
          $2::date,
          $3::text,
          $4::text,
          $5::boolean,
          $6::text
        )
        on conflict (timesheet_id, work_date)
        do update set
          day_type = excluded.day_type,
          leave_type = excluded.leave_type,
          overnight = excluded.overnight,
          notes = excluded.notes,
          updated_at = now()
        returning id::text
      `,
      [
        timesheet.id,
        payload.workDate,
        dayType,
        leaveType,
        payload.overnightAllowance,
        payload.notes ?? null,
      ],
    );

    await transaction.unsafe(
      `
        delete from timesheet_entries
        where timesheet_day_id = $1::uuid
      `,
      [timesheetDay.id],
    );

    if (payload.entryType === "work") {
      const paidHoursByEntry = allocatePaidHoursAcrossEntries(payload.workEntries);

      for (const [index, entry] of payload.workEntries.entries()) {
        await transaction.unsafe(
          `
            insert into timesheet_entries (
              timesheet_day_id,
              job_id,
              start_time,
              end_time,
              hours,
              rate_type,
              notes
            ) values (
              $1::uuid,
              $2::uuid,
              $3::time,
              $4::time,
              $5::numeric,
              $6::text,
              $7::text
            )
          `,
          [
            timesheetDay.id,
            entry.jobId,
            entry.startTime,
            entry.finishTime,
            paidHoursByEntry[index],
            "ordinary",
            entry.notes ?? null,
          ],
        );
      }
    } else {
      await transaction.unsafe(
        `
          insert into timesheet_entries (
            timesheet_day_id,
            job_id,
            start_time,
            end_time,
            hours,
            rate_type,
            notes
          ) values (
            $1::uuid,
            null,
            null,
            null,
            $2::numeric,
            $3::text,
            $4::text
          )
        `,
        [
          timesheetDay.id,
          payload.leaveHours ?? payload.paidHours,
          "day_off",
          payload.notes ?? null,
        ],
      );
    }

    const [totals] = await transaction.unsafe<
      Array<{ computed_total_hours: string; computed_total_overnights: number }>
    >(
      `
        select
          computed_total_hours::text,
          computed_total_overnights
        from timesheet_totals_v
        where id = $1::uuid
      `,
      [timesheet.id],
    );

    await transaction.unsafe(
      `
        update timesheets
        set
          total_hours = $2::numeric,
          total_overnights = $3::integer,
          updated_at = now()
        where id = $1::uuid
      `,
      [
        timesheet.id,
        totals?.computed_total_hours ?? String(payload.paidHours),
        totals?.computed_total_overnights ?? (payload.overnightAllowance ? 1 : 0),
      ],
    );

    return {
      id: timesheet.id,
      status: timesheet.status,
      action: existingDay?.existing_day_id ? "updated" : "created",
      userId: user.id,
      userName: user.full_name,
      workDate: payload.workDate,
      clientSubmissionId: payload.clientSubmissionId ?? null,
      entryCount: payload.entryType === "work" ? payload.workEntries.length : 1,
    };
  });
}

function mapLeaveTypeToEntryType(value: TimesheetHistoryRow["leave_type"]): EntryType {
  switch (value) {
    case "annual":
      return "annual_leave";
    case "sick":
      return "sick_leave";
    case "unpaid":
      return "unpaid_leave";
    default:
      return "work";
  }
}

export async function getTimesheetHistoryForEmployee(userId: string): Promise<TimesheetHistoryPeriod[]> {
  const db = getDb();
  const today = getTodayInTimeZone(APP_TIME_ZONE);
  const currentWeekStart = getWeekStartMonday(today);
  const previousWeekStart = addDaysToDateString(currentWeekStart, -7);
  const weekStarts = [currentWeekStart, previousWeekStart];
  const periodKeys = new Map<string, "current" | "previous">([
    [currentWeekStart, "current"],
    [previousWeekStart, "previous"],
  ]);

  const rows = await db.unsafe<TimesheetHistoryRow[]>(
    `
      select
        t.week_start::date::text as week_start,
        (t.week_start + interval '6 day')::date::text as week_end,
        t.status::text as timesheet_status,
        t.submitted_at::timestamptz::text as submitted_at,
        t.total_hours::text as total_hours,
        t.total_overnights as total_overnights,
        td.work_date::date::text as work_date,
        td.day_type::text as day_type,
        td.leave_type::text as leave_type,
        td.overnight as overnight,
        td.notes::text as day_notes,
        te.hours::text as entry_hours,
        te.rate_type::text as rate_type,
        te.notes::text as entry_notes,
        te.start_time::text as start_time,
        te.end_time::text as end_time,
        j.job_number::text as job_code,
        j.title::text as job_name,
        c.name::text as client_name,
        coalesce(j.site_name::text, j.site_address::text, 'Unknown site') as site_name
      from timesheets t
      join timesheet_days td on td.timesheet_id = t.id
      left join timesheet_entries te on te.timesheet_day_id = td.id
      left join jobs j on j.id = te.job_id
      left join clients c on c.id = j.client_id
      where t.user_id = $1::uuid
        and t.week_start = any($2::date[])
      order by
        t.week_start desc,
        td.work_date desc,
        te.start_time asc nulls last,
        te.created_at asc nulls last
    `,
    [userId, weekStarts],
  );

  const periods = new Map<string, TimesheetHistoryPeriod>();

  for (const weekStart of weekStarts) {
    periods.set(weekStart, {
      key: periodKeys.get(weekStart) ?? "previous",
      weekStart,
      weekEnd: addDaysToDateString(weekStart, 6),
      totalHours: 0,
      totalOvernights: 0,
      days: [],
    });
  }

  for (const row of rows) {
    const period = periods.get(row.week_start);

    if (!period) {
      continue;
    }

    period.status ??= row.timesheet_status ?? undefined;
    period.submittedAt ??= row.submitted_at ?? undefined;
    period.totalHours = Number(row.total_hours ?? "0");
    period.totalOvernights = row.total_overnights ?? 0;
    period.weekEnd = row.week_end;

    let day = period.days.find((item) => item.workDate === row.work_date);

    if (!day) {
      day = {
        workDate: row.work_date,
        entryType: row.day_type === "work" ? "work" : mapLeaveTypeToEntryType(row.leave_type),
        overnightAllowance: row.overnight,
        notes: row.day_notes ?? undefined,
        paidHours: 0,
        leaveHours: undefined,
        entries: [],
      };
      period.days.push(day);
    }

    if (row.entry_hours) {
      const entryHours = Number(row.entry_hours);

      day.entries.push({
        jobCode: row.job_code ?? undefined,
        jobName: row.job_name ?? undefined,
        clientName: row.client_name ?? undefined,
        siteName: row.site_name ?? undefined,
        startTime: row.start_time ?? undefined,
        finishTime: row.end_time ?? undefined,
        hours: entryHours,
        rateType: row.rate_type ?? undefined,
        notes: row.entry_notes ?? undefined,
      });

      day.paidHours += entryHours;

      if (day.entryType !== "work") {
        day.leaveHours = (day.leaveHours ?? 0) + entryHours;
      }
    }
  }

  for (const period of periods.values()) {
    period.days.sort((left, right) => left.workDate.localeCompare(right.workDate));
  }

  return weekStarts.map((weekStart) => periods.get(weekStart)!);
}
