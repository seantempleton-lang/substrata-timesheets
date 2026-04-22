export type EntryType = "work" | "annual_leave" | "sick_leave" | "unpaid_leave";

export type JobOption = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  siteName: string;
  isActive: boolean;
};

export type EmployeeOption = {
  id: string;
  employeeCode: string;
  fullName: string;
  initials: string;
  roleTitle: string;
  email?: string;
  division?: string;
  region?: string;
};

export type TimesheetWorkEntryPayload = {
  jobId: string;
  jobCode?: string;
  jobName?: string;
  clientName?: string;
  siteName?: string;
  startTime: string;
  finishTime: string;
  notes?: string;
};

export type TimesheetPayload = {
  userId?: string;
  employeeName: string;
  employeeCode?: string;
  workDate: string;
  entryType: EntryType;
  workEntries: TimesheetWorkEntryPayload[];
  leaveHours?: number;
  lunchBreakHours: number;
  paidHours: number;
  overnightAllowance: boolean;
  notes?: string;
  submittedAt?: string;
  source?: string;
};

export type AppBootstrap = {
  jobs: JobOption[];
  databaseReady: boolean;
  mode: "live" | "demo";
  message: string;
};
