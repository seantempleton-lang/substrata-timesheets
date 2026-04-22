"use client";

import { type ChangeEvent, startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";

import styles from "./mobile-timesheet-app.module.css";
import { calculatePaidHours, entryTypeLabels, formatToday } from "@/lib/timesheets";
import type { AppBootstrap, EmployeeOption, EntryType, JobOption, TimesheetPayload } from "@/lib/types";

type SubmissionState = {
  tone: "idle" | "success" | "warning" | "error";
  message: string;
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

type FormState = {
  userId: string;
  employeeName: string;
  employeeCode: string;
  workDate: string;
  entryType: EntryType;
  jobId: string;
  startTime: string;
  finishTime: string;
  leaveHours: string;
  overnightAllowance: boolean;
  notes: string;
};

const queueStorageKey = "substrata.mobile.pending-timesheets.v1";

function createInitialForm(): FormState {
  return {
    userId: "",
    employeeName: "",
    employeeCode: "",
    workDate: formatToday(),
    entryType: "work",
    jobId: "",
    startTime: "07:00",
    finishTime: "17:00",
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

function buildPayload(form: FormState, jobs: JobOption[]): TimesheetPayload {
  const selectedJob = jobs.find((job) => job.id === form.jobId);
  const paidHours =
    form.entryType === "work"
      ? calculatePaidHours(form.startTime, form.finishTime)
      : Number(form.leaveHours);

  return {
    userId: form.userId || undefined,
    employeeName: form.employeeName.trim(),
    employeeCode: form.employeeCode.trim() || undefined,
    workDate: form.workDate,
    entryType: form.entryType,
    jobId: selectedJob?.id,
    jobCode: selectedJob?.code,
    jobName: selectedJob?.name,
    clientName: selectedJob?.clientName,
    siteName: selectedJob?.siteName,
    startTime: form.entryType === "work" ? form.startTime : undefined,
    finishTime: form.entryType === "work" ? form.finishTime : undefined,
    leaveHours: form.entryType === "work" ? undefined : Number(form.leaveHours),
    lunchBreakHours: 0.5,
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

async function postTimesheet(payload: TimesheetPayload) {
  const response = await fetch("/api/timesheets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Unable to save this timesheet entry.");
  }

  return response.json();
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
  setPendingCount: (count: number) => void,
  setStatus: (state: SubmissionState) => void,
) {
  if (typeof window === "undefined" || !navigator.onLine) {
    return;
  }

  const queue = readQueue();

  if (queue.length === 0) {
    setPendingCount(0);
    return;
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
  setPendingCount(remaining.length);

  if (remaining.length === 0) {
    setStatus({
      tone: "success",
      message: "Pending offline entries were synced to Postgres.",
    });
  }
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
  const [jobSearch, setJobSearch] = useState("");
  const [pendingCount, setPendingCount] = useState(() =>
    typeof window === "undefined" ? 0 : readQueue().length,
  );
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [status, setStatus] = useState<SubmissionState>({
    tone: bootstrap.databaseReady ? "idle" : "warning",
    message: bootstrap.message,
  });

  const deferredJobSearch = useDeferredValue(jobSearch);
  const filteredJobs = useMemo(() => {
    const needle = deferredJobSearch.trim().toLowerCase();

    if (!needle) {
      return jobs;
    }

    return jobs.filter((job) =>
      [job.code, job.name, job.clientName, job.siteName]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [deferredJobSearch, jobs]);

  const selectedJob = jobs.find((job) => job.id === form.jobId);
  const paidHours =
    form.entryType === "work"
      ? calculatePaidHours(form.startTime, form.finishTime)
      : Number(form.leaveHours || 0);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
      void flushPendingQueueRequest(setPendingCount, setStatus);
    }

    function handleOffline() {
      setIsOnline(false);
      setStatus({
        tone: "warning",
        message: "You are offline. New entries will queue on this device and sync once you reconnect.",
      });
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    void flushPendingQueueRequest(setPendingCount, setStatus);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    startTransition(() => {
      setForm((current) => {
        if (current.entryType !== "work" || current.jobId || jobs.length === 0) {
          return current;
        }

        return {
          ...current,
          jobId: jobs[0].id,
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
        tone: "warning",
        message: "Signed out on this device. Log in again to submit more time.",
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
        id: crypto.randomUUID(),
        payload,
        queuedAt: new Date().toISOString(),
      },
    ];

    writeQueue(nextQueue);
    setPendingCount(nextQueue.length);
  }

  async function handleSubmit() {
    const payload = buildPayload(form, jobs);

    if (!activeEmployee) {
      setStatus({
        tone: "error",
        message: "Log in before you can submit a timesheet.",
      });
      return;
    }

    if (payload.entryType === "work" && !payload.jobId) {
      setStatus({
        tone: "error",
        message: "Choose a job before submitting a worked shift.",
      });
      return;
    }

    if (payload.paidHours <= 0) {
      setStatus({
        tone: "error",
        message: "Shift length must still leave paid time after the mandatory 30 minute lunch break.",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (!navigator.onLine) {
        queueSubmission(payload);
        setStatus({
          tone: "warning",
          message: "No signal right now, so the entry has been queued on this phone for later sync.",
        });
      } else {
        await postTimesheet(payload);
        setStatus({
          tone: "success",
          message: "Timesheet submitted and synced to Postgres.",
        });
      }

      setForm((current) => ({
        ...createInitialFormForEmployee(activeEmployee),
        workDate: current.workDate,
      }));
      setJobSearch("");
      void flushPendingQueueRequest(setPendingCount, setStatus);
    } catch (error) {
      queueSubmission(payload);
      setStatus({
        tone: "warning",
        message:
          error instanceof Error
            ? `${error.message} The entry has been safely queued and will retry automatically.`
            : "The entry has been safely queued and will retry automatically.",
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
          <span>{pendingCount} pending sync</span>
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
                <h2>Entry details</h2>
                <p>Choose worked time or a leave type, then complete only the fields that matter.</p>
              </div>
              <label className={styles.field}>
                <span>Date worked</span>
                <input
                  type="date"
                  value={form.workDate}
                  onChange={(event) => updateField("workDate", event.target.value)}
                />
              </label>

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
            </section>

            {form.entryType === "work" ? (
              <>
                <section className={styles.block}>
                  <div className={styles.sectionHeading}>
                    <h2>Job selection</h2>
                    <p>Projects come from Postgres and auto-fill client and site details.</p>
                  </div>
                  <label className={styles.field}>
                    <span>Find job</span>
                    <input
                      placeholder="Search by job code, project, client or site"
                      value={jobSearch}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        setJobSearch(event.target.value)
                      }
                    />
                  </label>

                  <div className={styles.jobList}>
                    {filteredJobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        className={form.jobId === job.id ? styles.jobCardActive : styles.jobCard}
                        onClick={() => updateField("jobId", job.id)}
                      >
                        <strong>
                          {job.code} - {job.name}
                        </strong>
                        <span>{job.clientName}</span>
                        <span>{job.siteName}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className={styles.block}>
                  <div className={styles.sectionHeading}>
                    <h2>Shift timing</h2>
                    <p>The unpaid 30 minute lunch deduction is always applied.</p>
                  </div>

                  <div className={styles.timeGrid}>
                    <label className={styles.field}>
                      <span>Start</span>
                      <input
                        type="time"
                        value={form.startTime}
                        onChange={(event) => updateField("startTime", event.target.value)}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Finish</span>
                      <input
                        type="time"
                        value={form.finishTime}
                        onChange={(event) => updateField("finishTime", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className={styles.summaryStrip}>
                    <div>
                      <span>Client</span>
                      <strong>{selectedJob?.clientName ?? "Select a job"}</strong>
                    </div>
                    <div>
                      <span>Site</span>
                      <strong>{selectedJob?.siteName ?? "Select a job"}</strong>
                    </div>
                    <div>
                      <span>Paid hours</span>
                      <strong>{paidHours.toFixed(1)} hrs</strong>
                    </div>
                  </div>
                </section>
              </>
            ) : (
              <section className={styles.block}>
                <div className={styles.sectionHeading}>
                  <h2>Leave details</h2>
                  <p>Leave is recorded in paid or unpaid hours without a job requirement.</p>
                </div>
                <label className={styles.field}>
                  <span>Leave hours</span>
                  <input
                    type="number"
                    min="0.5"
                    max="24"
                    step="0.5"
                    value={form.leaveHours}
                    onChange={(event) => updateField("leaveHours", event.target.value)}
                  />
                </label>
                <div className={styles.quickHours}>
                  {["4", "8", "10", "12"].map((hours) => (
                    <button
                      key={hours}
                      type="button"
                      className={form.leaveHours === hours ? styles.choiceActive : styles.choice}
                      onClick={() => updateField("leaveHours", hours)}
                    >
                      {hours} hrs
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className={styles.block}>
              <div className={styles.sectionHeading}>
                <h2>Allowances and notes</h2>
                <p>Overnight allowance is available when the crew is working away from home.</p>
              </div>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={form.overnightAllowance}
                  onChange={(event) => updateField("overnightAllowance", event.target.checked)}
                />
                <span>Overnight allowance applies</span>
              </label>
              <label className={styles.field}>
                <span>Notes</span>
                <textarea
                  rows={4}
                  placeholder="Optional notes for supervisor review"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </label>
            </section>

            <footer className={styles.submitBar}>
              <div>
                <span>Ready to send</span>
                <strong>{paidHours.toFixed(1)} hrs</strong>
              </div>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit timesheet"}
              </button>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
