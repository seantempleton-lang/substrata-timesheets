import { getDb } from "@/lib/db";
import {
  allocatePaidHoursAcrossEntries,
  timesheetPayloadSchema,
} from "@/lib/timesheets";
import type { TimesheetPayload } from "@/lib/types";

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
      userId: user.id,
      userName: user.full_name,
      workDate: payload.workDate,
      entryCount: payload.entryType === "work" ? payload.workEntries.length : 1,
    };
  });
}
