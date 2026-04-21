import { z } from "zod";

import type { AppBootstrap, EmployeeOption, EntryType, JobOption } from "@/lib/types";

const HALF_HOUR_BREAK = 0.5;

export const entryTypeLabels: Record<EntryType, string> = {
  work: "Worked shift",
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

export function calculatePaidHours(startTime: string, finishTime: string): number {
  const start = parseTimeToMinutes(startTime);
  const finish = parseTimeToMinutes(finishTime);

  if (finish <= start) {
    return 0;
  }

  const paidMinutes = finish - start - HALF_HOUR_BREAK * 60;

  if (paidMinutes <= 0) {
    return 0;
  }

  return roundToHalfHour(paidMinutes / 60);
}

export function parseTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function roundToHalfHour(value: number): number {
  return Math.round(value * 2) / 2;
}

export const timesheetPayloadSchema = z
  .object({
    employeeName: z.string().trim().min(2, "Employee name is required."),
    userId: z.string().uuid().optional(),
    employeeCode: z.string().trim().max(50).optional(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Work date is required."),
    entryType: z.enum(["work", "annual_leave", "sick_leave", "unpaid_leave"]),
    jobId: z.string().trim().optional(),
    jobCode: z.string().trim().optional(),
    jobName: z.string().trim().optional(),
    clientName: z.string().trim().optional(),
    siteName: z.string().trim().optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    finishTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    leaveHours: z.number().min(0.5).max(24).optional(),
    lunchBreakHours: z.number().min(HALF_HOUR_BREAK).max(HALF_HOUR_BREAK),
    paidHours: z.number().min(0.5).max(24),
    overnightAllowance: z.boolean(),
    notes: z.string().trim().max(500).optional(),
    submittedAt: z.string().optional(),
    source: z.string().optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.entryType === "work") {
      if (!payload.jobId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["jobId"],
          message: "Choose a job before submitting.",
        });
      }

      if (!payload.startTime || !payload.finishTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["startTime"],
          message: "Start and finish times are required for worked shifts.",
        });
        return;
      }

      const calculatedPaidHours = calculatePaidHours(payload.startTime, payload.finishTime);

      if (calculatedPaidHours <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finishTime"],
          message: "Finish time must be later than start time and include a 30 minute lunch break.",
        });
      }

      if (calculatedPaidHours !== payload.paidHours) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidHours"],
          message: "Paid hours do not match the enforced 30 minute lunch deduction.",
        });
      }
    }

    if (payload.entryType !== "work" && !payload.leaveHours) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["leaveHours"],
        message: "Leave hours are required for leave entries.",
      });
    }
  });

export function getDefaultBootstrap(): AppBootstrap {
  return {
    employees: demoEmployees,
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
