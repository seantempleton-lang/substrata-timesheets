import { z } from "zod";

import type {
  AppBootstrap,
  EmployeeOption,
  EntryType,
  JobOption,
  TimesheetWorkEntryPayload,
} from "@/lib/types";

export const MANDATORY_LUNCH_BREAK_HOURS = 0.5;
export const TIME_STEP_MINUTES = 15;

const DAY_MINUTES = 24 * 60;

export const entryTypeLabels: Record<EntryType, string> = {
  work: "Worked time",
  annual_leave: "Annual leave",
  sick_leave: "Sick leave",
  unpaid_leave: "Unpaid leave",
};

export const demoJobs: JobOption[] = [
  {
    id: "JOB-2417",
    code: "JOB-2417",
    name: "Central Plateau Coring",
    clientName: "Kereru Minerals",
    siteName: "Taupo Drill Pad 4",
    isActive: true,
  },
  {
    id: "JOB-2488",
    code: "JOB-2488",
    name: "South Ridge Geotech",
    clientName: "Pioneer Infrastructure",
    siteName: "Wellington Slip Remediation",
    isActive: true,
  },
  {
    id: "JOB-2503",
    code: "JOB-2503",
    name: "Waikato Monitoring Wells",
    clientName: "Arahura Water",
    siteName: "Hamilton West Borefield",
    isActive: true,
  },
];

export const demoEmployees: EmployeeOption[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    employeeCode: "ST001",
    fullName: "Jordan Smith",
    initials: "JS",
    roleTitle: "Driller",
    division: "Geotech",
    region: "North",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    employeeCode: "ST014",
    fullName: "Ariana Cole",
    initials: "AC",
    roleTitle: "Field Technician",
    division: "Water",
    region: "South",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    employeeCode: "ST027",
    fullName: "Mikaere Brown",
    initials: "MB",
    roleTitle: "Supervisor",
    division: "Geotech",
    region: "North",
  },
];

export function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return Number.NaN;
  }

  return hours * 60 + minutes;
}

export function isQuarterHourTime(value: string): boolean {
  const minutes = parseTimeToMinutes(value);

  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= DAY_MINUTES) {
    return false;
  }

  return minutes % TIME_STEP_MINUTES === 0;
}

export function formatHours(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function buildTimeOptions(): string[] {
  return Array.from({ length: DAY_MINUTES / TIME_STEP_MINUTES }, (_, index) => {
    const totalMinutes = index * TIME_STEP_MINUTES;
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
  });
}

export function calculateWorkedMinutes(startTime: string, finishTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const finish = parseTimeToMinutes(finishTime);

  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) {
    return 0;
  }

  return finish - start;
}

export function calculatePaidHours(startTime: string, finishTime: string): number {
  return calculateDayPaidHours([{ startTime, finishTime }]);
}

export function calculateDayPaidHours(
  entries: Array<Pick<TimesheetWorkEntryPayload, "startTime" | "finishTime">>,
): number {
  const totalMinutes = entries.reduce(
    (sum, entry) => sum + calculateWorkedMinutes(entry.startTime, entry.finishTime),
    0,
  );
  const paidMinutes = totalMinutes - MANDATORY_LUNCH_BREAK_HOURS * 60;

  if (paidMinutes <= 0) {
    return 0;
  }

  return paidMinutes / 60;
}

export function allocatePaidHoursAcrossEntries(
  entries: Array<Pick<TimesheetWorkEntryPayload, "startTime" | "finishTime">>,
): number[] {
  const rawMinutes = entries.map((entry) => calculateWorkedMinutes(entry.startTime, entry.finishTime));
  let remainingLunchMinutes = MANDATORY_LUNCH_BREAK_HOURS * 60;
  const adjustedMinutes = [...rawMinutes];

  const indexesByDuration = rawMinutes
    .map((minutes, index) => ({ minutes, index }))
    .sort((left, right) => right.minutes - left.minutes)
    .map((item) => item.index);

  for (const index of indexesByDuration) {
    if (remainingLunchMinutes <= 0) {
      break;
    }

    const deduction = Math.min(adjustedMinutes[index], remainingLunchMinutes);
    adjustedMinutes[index] -= deduction;
    remainingLunchMinutes -= deduction;
  }

  return adjustedMinutes.map((minutes) => Math.max(0, minutes) / 60);
}

function hasOverlappingEntries(entries: TimesheetWorkEntryPayload[]): boolean {
  const ordered = entries
    .map((entry) => ({
      start: parseTimeToMinutes(entry.startTime),
      finish: parseTimeToMinutes(entry.finishTime),
    }))
    .sort((left, right) => left.start - right.start);

  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].start < ordered[index - 1].finish) {
      return true;
    }
  }

  return false;
}

const workEntrySchema = z.object({
  jobId: z.string().trim().min(1, "Choose a job."),
  jobCode: z.string().trim().optional(),
  jobName: z.string().trim().optional(),
  clientName: z.string().trim().optional(),
  siteName: z.string().trim().optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  finishTime: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().trim().max(500).optional(),
});

export const timesheetPayloadSchema = z
  .object({
    employeeName: z.string().trim().min(2, "Employee name is required."),
    userId: z.string().uuid().optional(),
    employeeCode: z.string().trim().max(50).optional(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Work date is required."),
    entryType: z.enum(["work", "annual_leave", "sick_leave", "unpaid_leave"]),
    workEntries: z.array(workEntrySchema).default([]),
    leaveHours: z.number().min(0.25).max(24).optional(),
    lunchBreakHours: z
      .number()
      .min(MANDATORY_LUNCH_BREAK_HOURS)
      .max(MANDATORY_LUNCH_BREAK_HOURS),
    paidHours: z.number().min(0.25).max(24),
    overnightAllowance: z.boolean(),
    notes: z.string().trim().max(500).optional(),
    submittedAt: z.string().optional(),
    source: z.string().optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.entryType === "work") {
      if (payload.workEntries.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workEntries"],
          message: "Add at least one time entry before submitting.",
        });
        return;
      }

      payload.workEntries.forEach((entry, index) => {
        if (!isQuarterHourTime(entry.startTime)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workEntries", index, "startTime"],
            message: "Start time must be in 15 minute increments.",
          });
        }

        if (!isQuarterHourTime(entry.finishTime)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workEntries", index, "finishTime"],
            message: "Finish time must be in 15 minute increments.",
          });
        }

        if (calculateWorkedMinutes(entry.startTime, entry.finishTime) <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["workEntries", index, "finishTime"],
            message: "Finish time must be later than start time.",
          });
        }
      });

      if (hasOverlappingEntries(payload.workEntries)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workEntries"],
          message: "Entries on the same day cannot overlap.",
        });
      }

      const calculatedPaidHours = calculateDayPaidHours(payload.workEntries);

      if (calculatedPaidHours <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidHours"],
          message: "The day's entries must leave paid time after the mandatory 30 minute lunch break.",
        });
      }

      if (calculatedPaidHours !== payload.paidHours) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidHours"],
          message: "Paid hours do not match the combined entries with the enforced 30 minute lunch deduction.",
        });
      }
    }

    if (payload.entryType !== "work") {
      if (!payload.leaveHours) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaveHours"],
          message: "Leave hours are required for leave entries.",
        });
      }

      if (payload.workEntries.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["workEntries"],
          message: "Leave days cannot also include worked time entries.",
        });
      }
    }
  });

export function getDefaultBootstrap(): AppBootstrap {
  return {
    jobs: demoJobs,
    databaseReady: false,
    mode: "demo",
    message:
      "Database connection is not configured yet. The app is running with demo jobs until DATABASE_URL and the job source view are supplied.",
  };
}

export function formatToday(): string {
  return new Date().toISOString().slice(0, 10);
}
