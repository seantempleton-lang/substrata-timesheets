"use client";

import { startTransition, useEffect, useMemo, useState } from "react";

import styles from "./mobile-timesheet-app.module.css";
import {
  buildTimeOptions,
  calculateDayPaidHours,
  entryTypeLabels,
  formatHours,
  formatToday,
  getWeekEndSunday,
  MANDATORY_LUNCH_BREAK_HOURS,
} from "@/lib/timesheets";
import type {
  AppBootstrap,
  EmployeeOption,
  EntryType,
  JobOption,
  TimesheetHistoryPeriod,
  TimesheetPayload,
  TimesheetWorkEntryPayload,
} from "@/lib/types";

type SubmissionState = {
  tone: "idle" | "success" | "warning" | "error";
  message: string;
};

type FlushQueueResult = {
  attemptedCount: number;
  syncedCount: number;
  remainingCount: number;
};

type PendingSubmission = {
  id: string;
  payload: TimesheetPayload;
  queuedAt: string;
};

type LoginState = {
  email: string;
  password: string;
};

type WorkEntryFormState = {
  id: string;
  jobId: string;
  startTime: string;
  finishTime: string;
  notes: string;
};

type FormState = {
  userId: string;
  employeeName: string;
  employeeCode: string;
  workDate: string;
  entryType: EntryType;
  workEntries: WorkEntryFormState[];
  leaveHours: string;
  overnightAllowance: boolean;
  notes: string;
};

type SyncActivityState = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSyncedCount: number;
  lastRemainingCount: number;
};

type HistoryState = {
  loading: boolean;
  error: string | null;
  periods: TimesheetHistoryPeriod[];
};

type TimesheetPostResponse = {
  ok?: boolean;
  record?: {
    action?: "created" | "updated";
    clientSubmissionId?: string | null;
  };
  error?: string;
};

const queueStorageKey = "substrata.mobile.pending-timesheets.v1";
const timeOptions = buildTimeOptions();
const leaveHourOptions = ["4", "8", "10", "12"];
const shortDateFormatter = new Intl.DateTimeFormat("en-NZ", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyWorkEntry(): WorkEntryFormState {
  return {
    id: createId(),
    jobId: "",
    startTime: "07:00",
    finishTime: "17:00",
    notes: "",
  };
}

function createInitialForm(): FormState {
  return {
    userId: "",
    employeeName: "",
    employeeCode: "",
    workDate: formatToday(),
    entryType: "work",
    workEntries: [createEmptyWorkEntry()],
    leaveHours: "8",
    overnightAllowance: false,
    notes: "",
  };
}

function createInitialFormForEmployee(employee: EmployeeOption | null): FormState {
  const base = createInitialForm();

  if (!employee) {
    return base;
  }

  return {
    ...base,
    userId: employee.id,
    employeeName: employee.fullName,
    employeeCode: employee.employeeCode,
  };
}

function buildPayload(form: FormState, jobs: JobOption[], clientSubmissionId: string): TimesheetPayload {
  const workEntries: TimesheetWorkEntryPayload[] =
    form.entryType === "work"
      ? form.workEntries
          .filter((entry) => entry.jobId)
          .map((entry) => {
            const selectedJob = jobs.find((job) => job.id === entry.jobId);

            return {
              jobId: entry.jobId,
              jobCode: selectedJob?.code,
              jobName: selectedJob?.name,
              clientName: selectedJob?.clientName,
              siteName: selectedJob?.siteName,
              startTime: entry.startTime,
              finishTime: entry.finishTime,
              notes: entry.notes.trim() || undefined,
            };
          })
      : [];

  const paidHours =
    form.entryType === "work" ? calculateDayPaidHours(workEntries) : Number(form.leaveHours);

  return {
    userId: form.userId || undefined,
    employeeName: form.employeeName.trim(),
    employeeCode: form.employeeCode.trim() || undefined,
    workDate: form.workDate,
    clientSubmissionId,
    entryType: form.entryType,
    workEntries,
    leaveHours: form.entryType === "work" ? undefined : Number(form.leaveHours),
    lunchBreakHours: MANDATORY_LUNCH_BREAK_HOURS,
    paidHours,
    overnightAllowance: form.overnightAllowance,
    notes: form.notes.trim() || undefined,
    submittedAt: new Date().toISOString(),
    source: "mobile-web",
  };
}

function readQueue(): PendingSubmission[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(queueStorageKey);
    return raw ? (JSON.parse(raw) as PendingSubmission[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: PendingSubmission[]) {
  window.localStorage.setItem(queueStorageKey, JSON.stringify(queue));
}

function syncPendingQueue(setPendingQueue: (queue: PendingSubmission[]) => void) {
  setPendingQueue(readQueue());
}

function formatDisplayDate(value: string) {
  return shortDateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatDisplayDateTime(value: string | null) {
  if (!value) {
    return "Not yet";
  }

  return dateTimeFormatter.format(new Date(value));
}

function describePendingSubmission(item: PendingSubmission) {
  if (item.payload.entryType === "work") {
    const jobs = Array.from(
      new Set(item.payload.workEntries.map((entry) => entry.jobCode ?? entry.jobName ?? "Job row")),
    );

    return `${jobs.join(", ")}${jobs.length > 0 ? " " : ""}(${item.payload.workEntries.length} row${item.payload.workEntries.length === 1 ? "" : "s"})`;
  }

  return `${entryTypeLabels[item.payload.entryType]} (${formatHours(item.payload.leaveHours ?? item.payload.paidHours)}h)`;
}

async function postTimesheet(payload: TimesheetPayload) {
  const response = await fetch("/api/timesheets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => null)) as TimesheetPostResponse | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "Unable to save this timesheet entry.");
  }

  return body;
}

async function fetchTimesheetHistory() {
  const response = await fetch("/api/timesheets", { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as
    | { periods?: TimesheetHistoryPeriod[]; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "Unable to load your recent timesheets.");
  }

  return body?.periods ?? [];
}

async function postLogin(credentials: LoginState) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });

  const body = (await response.json().catch(() => null)) as
    | { employee?: EmployeeOption; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(body?.error ?? "Unable to sign in.");
  }

  return body?.employee ?? null;
}

async function postLogout() {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Unable to log out.");
  }
}

async function flushPendingQueueRequest(
  setPendingQueue: (queue: PendingSubmission[]) => void,
): Promise<FlushQueueResult> {
  const queue = readQueue();

  if (typeof window === "undefined" || !navigator.onLine) {
    syncPendingQueue(setPendingQueue);
    return {
      attemptedCount: queue.length,
      syncedCount: 0,
      remainingCount: queue.length,
    };
  }

  if (queue.length === 0) {
    setPendingQueue([]);
    return {
      attemptedCount: 0,
      syncedCount: 0,
      remainingCount: 0,
    };
  }

  const remaining: PendingSubmission[] = [];

  for (const item of queue) {
    try {
      await postTimesheet(item.payload);
    } catch {
      remaining.push(item);
    }
  }

  writeQueue(remaining);
  setPendingQueue(remaining);

  return {
    attemptedCount: queue.length,
    syncedCount: queue.length - remaining.length,
    remainingCount: remaining.length,
  };
}

export function MobileTimesheetApp({
  bootstrap,
  initialEmployee,
}: {
  bootstrap: AppBootstrap;
  initialEmployee: EmployeeOption | null;
}) {
  const [jobs, setJobs] = useState<JobOption[]>(bootstrap.jobs);
  const [form, setForm] = useState<FormState>(() => createInitialFormForEmployee(initialEmployee));
  const [activeEmployee, setActiveEmployee] = useState<EmployeeOption | null>(initialEmployee);
  const [login, setLogin] = useState<LoginState>({
    email: initialEmployee?.email ?? "",
    password: "",
  });
  const [pendingQueue, setPendingQueue] = useState<PendingSubmission[]>(() =>
    typeof window === "undefined" ? [] : readQueue(),
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [syncActivity, setSyncActivity] = useState<SyncActivityState>({
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastSyncedCount: 0,
    lastRemainingCount: pendingQueue.length,
  });
  const [history, setHistory] = useState<HistoryState>({
    loading: Boolean(initialEmployee),
    error: null,
    periods: [],
  });
  const [status, setStatus] = useState<SubmissionState>({
    tone: bootstrap.databaseReady ? "idle" : "warning",
    message: bootstrap.message,
  });

  const pendingCount = pendingQueue.length;
  const paidHours =
    form.entryType === "work"
      ? calculateDayPaidHours(
          form.workEntries
            .filter((entry) => entry.jobId)
            .map((entry) => ({
              startTime: entry.startTime,
              finishTime: entry.finishTime,
            })),
        )
      : Number(form.leaveHours || 0);

  const totalWorkedHours = useMemo(
    () =>
      form.workEntries.reduce((sum, entry) => {
        const start = Number(entry.startTime.slice(0, 2)) * 60 + Number(entry.startTime.slice(3));
        const finish = Number(entry.finishTime.slice(0, 2)) * 60 + Number(entry.finishTime.slice(3));
        return finish > start ? sum + (finish - start) / 60 : sum;
      }, 0),
    [form.workEntries],
  );

  async function loadHistory() {
    if (!activeEmployee) {
      setHistory({
        loading: false,
        error: null,
        periods: [],
      });
      return;
    }

    setHistory((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const periods = await fetchTimesheetHistory();
      setHistory({
        loading: false,
        error: null,
        periods,
      });
    } catch (error) {
      setHistory({
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load recent timesheets.",
        periods: [],
      });
    }
  }

  async function syncQueuedSubmissions(options: { manual: boolean }) {
    syncPendingQueue(setPendingQueue);
    const queuedCount = readQueue().length;
    const attemptedAt = new Date().toISOString();

    if (!activeEmployee) {
      setSyncActivity((current) => ({
        ...current,
        lastAttemptAt: attemptedAt,
        lastRemainingCount: queuedCount,
      }));

      if (options.manual && queuedCount > 0) {
        setStatus({
          tone: "warning",
          message: "Log back in on this device before pending day sheets can sync.",
        });
      }

      return;
    }

    if (!navigator.onLine) {
      setSyncActivity((current) => ({
        ...current,
        lastAttemptAt: attemptedAt,
        lastRemainingCount: queuedCount,
      }));

      if (options.manual) {
        setStatus({
          tone: "warning",
          message: "Still offline. Pending day sheets will sync automatically once this device reconnects.",
        });
      }

      return;
    }

    if (queuedCount === 0) {
      setSyncActivity((current) => ({
        ...current,
        lastAttemptAt: attemptedAt,
        lastSyncedCount: 0,
        lastRemainingCount: 0,
      }));

      if (options.manual) {
        setStatus({
          tone: "success",
          message: "No pending day sheets to sync.",
        });
      }

      return;
    }

    setIsSyncingQueue(true);

    try {
      const result = await flushPendingQueueRequest(setPendingQueue);

      setSyncActivity((current) => ({
        ...current,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: result.syncedCount > 0 ? new Date().toISOString() : current.lastSuccessAt,
        lastSyncedCount: result.syncedCount,
        lastRemainingCount: result.remainingCount,
      }));

      if (result.remainingCount > 0) {
        setStatus({
          tone: "warning",
          message: `${result.syncedCount} synced, ${result.remainingCount} still pending. We'll keep retrying automatically when this device is online.`,
        });
      } else if (result.syncedCount > 0) {
        setStatus({
          tone: "success",
          message: `${result.syncedCount} pending day sheet${result.syncedCount === 1 ? "" : "s"} synced to Postgres.`,
        });
      }

      if (result.syncedCount > 0) {
        await loadHistory();
      }
    } finally {
      setIsSyncingQueue(false);
    }
  }

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void syncQueuedSubmissions({ manual: false });
    }

    function handleOffline() {
      setIsOnline(false);
      syncPendingQueue(setPendingQueue);
      setStatus({
        tone: "warning",
        message: "You are offline. New day sheets will queue on this device and sync once you reconnect.",
      });
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === null || event.key === queueStorageKey) {
        syncPendingQueue(setPendingQueue);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        syncPendingQueue(setPendingQueue);
      }
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    syncPendingQueue(setPendingQueue);
    void syncQueuedSubmissions({ manual: false });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeEmployee]);

  useEffect(() => {
    void loadHistory();
  }, [activeEmployee]);

  useEffect(() => {
    startTransition(() => {
      setForm((current) => {
        if (current.entryType !== "work") {
          return current;
        }

        return {
          ...current,
          workEntries: current.workEntries.map((entry) =>
            entry.jobId || jobs.length === 0
              ? entry
              : {
                  ...entry,
                  jobId: jobs[0].id,
                },
          ),
        };
      });
    });
  }, [jobs]);

  async function refreshJobs() {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data = (await response.json()) as AppBootstrap;
      setJobs(data.jobs);
      setStatus({
        tone: data.databaseReady ? "success" : "warning",
        message: data.message,
      });
    } catch {
      setStatus({
        tone: "error",
        message: "Refresh failed. You can still use the last synced jobs on this device.",
      });
    }
  }

  function updateField<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateWorkEntry(
    entryId: string,
    key: keyof WorkEntryFormState,
    value: WorkEntryFormState[keyof WorkEntryFormState],
  ) {
    setForm((current) => ({
      ...current,
      workEntries: current.workEntries.map((entry) =>
        entry.id === entryId ? { ...entry, [key]: value } : entry,
      ),
    }));
  }

  function addWorkEntry() {
    setForm((current) => ({
      ...current,
      workEntries: [
        ...current.workEntries,
        {
          ...createEmptyWorkEntry(),
          jobId: jobs[0]?.id ?? "",
        },
      ],
    }));
  }

  function removeWorkEntry(entryId: string) {
    setForm((current) => {
      if (current.workEntries.length === 1) {
        return {
          ...current,
          workEntries: [createEmptyWorkEntry()],
        };
      }

      return {
        ...current,
        workEntries: current.workEntries.filter((entry) => entry.id !== entryId),
      };
    });
  }

  function applyAuthenticatedEmployee(employee: EmployeeOption) {
    setActiveEmployee(employee);
    setForm(createInitialFormForEmployee(employee));
    setLogin({
      email: employee.email ?? "",
      password: "",
    });
    setStatus({
      tone: "success",
      message: `${employee.fullName} is signed in on this device.`,
    });
  }

  async function handleLogout() {
    setIsLoggingOut(true);

    try {
      await postLogout();
      setActiveEmployee(null);
      setForm(createInitialForm());
      setLogin((current) => ({
        email: current.email,
        password: "",
      }));
      setStatus({
        tone: pendingCount > 0 ? "warning" : "idle",
        message:
          pendingCount > 0
            ? "Signed out on this device. Pending day sheets are still saved locally until you log back in and sync them."
            : "Signed out on this device. Log in again to submit more time.",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to log out.",
      });
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleLogin() {
    if (!login.email || !login.password) {
      setStatus({
        tone: "error",
        message: "Email and password are required.",
      });
      return;
    }

    setIsSigningIn(true);

    try {
      const employee = await postLogin(login);

      if (!employee) {
        throw new Error("No employee profile was returned from the server.");
      }

      applyAuthenticatedEmployee(employee);
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Unable to sign in.",
      });
    } finally {
      setIsSigningIn(false);
    }
  }

  function queueSubmission(payload: TimesheetPayload) {
    const queue = readQueue();
    const nextQueue = [
      ...queue,
      {
        id: payload.clientSubmissionId ?? createId(),
        payload,
        queuedAt: new Date().toISOString(),
      },
    ];

    writeQueue(nextQueue);
    setPendingQueue(nextQueue);
  }

  const pendingSyncLabel = isSyncingQueue
    ? "Syncing..."
    : `${pendingCount} pending sync${pendingCount === 1 ? "" : "s"}`;

  async function handleSubmit() {
    const payload = buildPayload(form, jobs, createId());

    if (!activeEmployee) {
      setStatus({
        tone: "error",
        message: "Log in before you can submit a timesheet.",
      });
      return;
    }

    if (payload.entryType === "work" && payload.workEntries.length === 0) {
      setStatus({
        tone: "error",
        message: "Add at least one completed row before submitting this day sheet.",
      });
      return;
    }

    if (payload.paidHours <= 0) {
      setStatus({
        tone: "error",
        message: "The total day must still leave paid time after the mandatory 30 minute lunch break.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (!navigator.onLine) {
        queueSubmission(payload);
        setStatus({
          tone: "warning",
          message: "No signal right now, so this day sheet has been queued on this phone for later sync.",
        });
      } else {
        const result = await postTimesheet(payload);
        setStatus({
          tone: "success",
          message:
            result?.record?.action === "updated"
              ? "This day sheet matched an existing day and has been updated instead of duplicated."
              : "Day sheet submitted and synced to Postgres.",
        });
      }

      setForm((current) => ({
        ...createInitialFormForEmployee(activeEmployee),
        workDate: current.workDate,
      }));
      await loadHistory();
      void syncQueuedSubmissions({ manual: false });
    } catch (error) {
      queueSubmission(payload);
      setStatus({
        tone: "warning",
        message:
          error instanceof Error
            ? `${error.message} The day sheet has been safely queued and will retry automatically.`
            : "The day sheet has been safely queued and will retry automatically.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.handset}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>SubStrata Field Timesheets</p>
            <h1>McMillan Drilling</h1>
          </div>
          <div className={styles.heroMeta}>
            <span className={isOnline ? styles.online : styles.offline}>
              {isOnline ? "Online" : "Offline queueing"}
            </span>
            <button className={styles.ghostButton} type="button" onClick={refreshJobs}>
              Refresh data
            </button>
          </div>
        </header>

        <section className={styles.statusPanel} data-tone={status.tone}>
          <p>{status.message}</p>
          <button
            className={styles.statusAction}
            type="button"
            onClick={() => void syncQueuedSubmissions({ manual: true })}
            disabled={isSyncingQueue}
          >
            {pendingSyncLabel}
          </button>
        </section>

        {!activeEmployee ? (
          <section className={styles.block}>
            <div className={styles.sectionHeading}>
              <h2>Login</h2>
              <p>Sign in with your mobile auth account linked to your personnel profile.</p>
            </div>
            <label className={styles.field}>
              <span>Email</span>
              <input
                autoComplete="email"
                type="email"
                placeholder="rahulnegi@drilling.co.nz"
                value={login.email}
                onChange={(event) => setLogin((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span>Password</span>
              <input
                autoComplete="current-password"
                type="password"
                placeholder="Enter your password"
                value={login.password}
                onChange={(event) => setLogin((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <button className={styles.primaryButton} type="button" onClick={handleLogin} disabled={isSigningIn}>
              {isSigningIn ? "Signing in..." : "Log in"}
            </button>
          </section>
        ) : (
          <>
            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Signed in</h2>
                <p>Your entries will be submitted under this personnel profile.</p>
              </div>
              <div className={styles.employeeSession}>
                <div className={styles.employeeBadge}>{activeEmployee.initials}</div>
                <div className={styles.employeeSessionCopy}>
                  <strong>{activeEmployee.fullName}</strong>
                  <span>
                    {activeEmployee.employeeCode} - {activeEmployee.roleTitle}
                  </span>
                  <span>{activeEmployee.email ?? login.email}</span>
                </div>
                <button className={styles.ghostButton} type="button" onClick={handleLogout} disabled={isLoggingOut}>
                  {isLoggingOut ? "Logging out..." : "Log out"}
                </button>
              </div>
            </section>

            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Sync queue</h2>
                <p>Queued day sheets stay on this device until they reach Postgres.</p>
              </div>

              <div className={styles.syncSummary}>
                <div>
                  <span>Pending</span>
                  <strong>{pendingCount}</strong>
                </div>
                <div>
                  <span>Last synced</span>
                  <strong>{syncActivity.lastSyncedCount}</strong>
                </div>
                <div>
                  <span>Last success</span>
                  <strong>{formatDisplayDateTime(syncActivity.lastSuccessAt)}</strong>
                </div>
                <div>
                  <span>Last attempt</span>
                  <strong>{formatDisplayDateTime(syncActivity.lastAttemptAt)}</strong>
                </div>
              </div>

              {pendingQueue.length === 0 ? (
                <p className={styles.emptyState}>No pending day sheets on this device.</p>
              ) : (
                <div className={styles.queueList}>
                  {pendingQueue.map((item) => (
                    <article className={styles.queueCard} key={item.id}>
                      <div className={styles.queueCardHeader}>
                        <strong>{formatDisplayDate(item.payload.workDate)}</strong>
                        <span>{formatDisplayDateTime(item.queuedAt)}</span>
                      </div>
                      <p>{describePendingSubmission(item)}</p>
                      <span className={styles.queueMeta}>
                        {formatHours(item.payload.paidHours)}h paid
                        {item.payload.overnightAllowance ? " | Overnight" : ""}
                      </span>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Your time</h2>
                <p>Review the current and previous weekly periods ending Sunday.</p>
              </div>

              {history.loading ? (
                <p className={styles.emptyState}>Loading your recent periods...</p>
              ) : history.error ? (
                <p className={styles.emptyState}>{history.error}</p>
              ) : history.periods.length === 0 ? (
                <p className={styles.emptyState}>No recent day sheets found for this profile yet.</p>
              ) : (
                <div className={styles.periodList}>
                  {history.periods.map((period) => (
                    <article className={styles.periodCard} key={period.key}>
                      <div className={styles.periodHeader}>
                        <div>
                          <p className={styles.periodEyebrow}>
                            {period.key === "current" ? "Current period" : "Previous period"}
                          </p>
                          <h3>
                            {formatDisplayDate(period.weekStart)} to {formatDisplayDate(period.weekEnd)}
                          </h3>
                        </div>
                        <span className={styles.periodStatus}>
                          {period.status ?? "Not submitted"}
                        </span>
                      </div>

                      <div className={styles.summaryStrip}>
                        <div>
                          <span>Week ends</span>
                          <strong>{formatDisplayDate(getWeekEndSunday(period.weekStart))}</strong>
                        </div>
                        <div>
                          <span>Total hours</span>
                          <strong>{formatHours(period.totalHours)}h</strong>
                        </div>
                        <div>
                          <span>Overnights</span>
                          <strong>{period.totalOvernights}</strong>
                        </div>
                        <div>
                          <span>Submitted</span>
                          <strong>{formatDisplayDateTime(period.submittedAt ?? null)}</strong>
                        </div>
                      </div>

                      {period.days.length === 0 ? (
                        <p className={styles.emptyState}>No entries recorded in this week yet.</p>
                      ) : (
                        <div className={styles.dayList}>
                          {period.days.map((day) => (
                            <article className={styles.dayCard} key={day.workDate}>
                              <div className={styles.dayHeader}>
                                <div>
                                  <strong>{formatDisplayDate(day.workDate)}</strong>
                                  <span>{entryTypeLabels[day.entryType]}</span>
                                </div>
                                <div className={styles.dayTotals}>
                                  <strong>{formatHours(day.paidHours)}h</strong>
                                  {day.overnightAllowance ? <span>Overnight</span> : null}
                                </div>
                              </div>

                              {day.entries.length > 0 ? (
                                <div className={styles.historyEntryList}>
                                  {day.entries.map((entry, index) => (
                                    <div className={styles.historyEntryRow} key={`${day.workDate}-${index}`}>
                                      <div>
                                        <strong>{entry.jobCode ?? entry.jobName ?? "Leave entry"}</strong>
                                        <span>
                                          {entry.startTime && entry.finishTime
                                            ? `${entry.startTime} - ${entry.finishTime}`
                                            : entry.clientName ?? "Recorded hours"}
                                        </span>
                                      </div>
                                      <strong>{formatHours(entry.hours)}h</strong>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {day.notes ? <p className={styles.dayNotes}>{day.notes}</p> : null}
                            </article>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Day sheet</h2>
                <p>Enter one full day at a time with as many job rows as needed. Time options are fixed to 15 minutes.</p>
              </div>

              <div className={styles.sheetHeader}>
                <label className={styles.field}>
                  <span>Date</span>
                  <input
                    type="date"
                    value={form.workDate}
                    onChange={(event) => updateField("workDate", event.target.value)}
                  />
                </label>
                <div className={styles.modeStack}>
                  <span className={styles.microLabel}>Day type</span>
                  <div className={styles.choiceRow}>
                    {(Object.keys(entryTypeLabels) as EntryType[]).map((entryType) => (
                      <button
                        key={entryType}
                        className={form.entryType === entryType ? styles.choiceActive : styles.choice}
                        type="button"
                        onClick={() => updateField("entryType", entryType)}
                      >
                        {entryTypeLabels[entryType]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {form.entryType === "work" ? (
              <section className={styles.block}>
                <div className={styles.sectionHeading}>
                  <h2>Time rows</h2>
                  <p>Each row matches one line from the field sheet. Add another row when the job changes during the day.</p>
                </div>

                <div className={styles.summaryStrip}>
                  <div>
                    <span>Rows</span>
                    <strong>{form.workEntries.length}</strong>
                  </div>
                  <div>
                    <span>Worked</span>
                    <strong>{formatHours(totalWorkedHours)}h</strong>
                  </div>
                  <div>
                    <span>Lunch</span>
                    <strong>{formatHours(MANDATORY_LUNCH_BREAK_HOURS)}h</strong>
                  </div>
                  <div>
                    <span>Paid</span>
                    <strong>{formatHours(paidHours)}h</strong>
                  </div>
                </div>

                <div className={styles.entryList}>
                  {form.workEntries.map((entry, index) => {
                    const selectedJob = jobs.find((job) => job.id === entry.jobId);

                    return (
                      <article className={styles.entryCard} key={entry.id}>
                        <div className={styles.entryCardHeader}>
                          <div>
                            <p className={styles.entryIndex}>Entry {index + 1}</p>
                            <strong>{selectedJob ? `${selectedJob.code} - ${selectedJob.clientName}` : "Choose a job"}</strong>
                          </div>
                          <button
                            className={styles.slimButton}
                            type="button"
                            onClick={() => removeWorkEntry(entry.id)}
                          >
                            Remove
                          </button>
                        </div>

                        <label className={styles.field}>
                          <span>Job</span>
                          <select
                            value={entry.jobId}
                            onChange={(event) => updateWorkEntry(entry.id, "jobId", event.target.value)}
                          >
                            <option value="">Select job</option>
                            {jobs.map((job) => (
                              <option key={job.id} value={job.id}>
                                {job.code} - {job.clientName} - {job.siteName}
                              </option>
                            ))}
                          </select>
                        </label>

                        {selectedJob ? (
                          <div className={styles.jobMeta}>
                            <div>
                              <span>Client</span>
                              <strong>{selectedJob.clientName}</strong>
                            </div>
                            <div>
                              <span>Site</span>
                              <strong>{selectedJob.siteName}</strong>
                            </div>
                          </div>
                        ) : null}

                        <div className={styles.timeGrid}>
                          <label className={styles.field}>
                            <span>Start</span>
                            <select
                              value={entry.startTime}
                              onChange={(event) => updateWorkEntry(entry.id, "startTime", event.target.value)}
                            >
                              {timeOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span>End</span>
                            <select
                              value={entry.finishTime}
                              onChange={(event) => updateWorkEntry(entry.id, "finishTime", event.target.value)}
                            >
                              {timeOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className={styles.field}>
                          <span>Job description / working with</span>
                          <textarea
                            placeholder="Travel, assist JP, washdrill install, meeting, crew notes"
                            value={entry.notes}
                            onChange={(event) => updateWorkEntry(entry.id, "notes", event.target.value)}
                          />
                        </label>
                      </article>
                    );
                  })}
                </div>

                <button className={styles.secondaryButton} type="button" onClick={addWorkEntry}>
                  Add another time row
                </button>
              </section>
            ) : (
              <section className={styles.block}>
                <div className={styles.sectionHeading}>
                  <h2>Leave details</h2>
                  <p>Choose the leave type above, then record the hours for this day.</p>
                </div>

                <div className={styles.quickHours}>
                  {leaveHourOptions.map((hours) => (
                    <button
                      key={hours}
                      className={form.leaveHours === hours ? styles.choiceActive : styles.choice}
                      type="button"
                      onClick={() => updateField("leaveHours", hours)}
                    >
                      {hours}h
                    </button>
                  ))}
                </div>

                <label className={styles.field}>
                  <span>Leave hours</span>
                  <input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={form.leaveHours}
                    onChange={(event) => updateField("leaveHours", event.target.value)}
                  />
                </label>
              </section>
            )}

            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Extras</h2>
                <p>Use overnight allowance when the crew is working away from home.</p>
              </div>

              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={form.overnightAllowance}
                  onChange={(event) => updateField("overnightAllowance", event.target.checked)}
                />
                <span>Overnight allowance applies for this day</span>
              </label>

              <label className={styles.field}>
                <span>Day notes</span>
                <textarea
                  placeholder="Optional note for the whole day"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </label>
            </section>

            <footer className={styles.submitBar}>
              <div>
                <span>Paid total</span>
                <strong>{formatHours(paidHours)}h</strong>
              </div>
              <button className={styles.primaryButton} type="button" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit day sheet"}
              </button>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}

