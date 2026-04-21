# SubStrata Field Timesheets

Separate mobile-only timesheet app for field crews. This project is designed to live alongside the main SubStrata Ops Manager production environment while using the same Postgres database.

## What it does

- Provides a mobile-first timesheet entry flow for field staff.
- Pulls jobs/projects from Postgres so the user can select the correct job.
- Auto-fills client and site details from the chosen job.
- Enforces a mandatory `0.5` hour unpaid lunch break for worked shifts.
- Supports `Annual Leave`, `Sick Leave`, and `Unpaid Leave`.
- Supports an `Overnight Allowance` flag for away-from-home work.
- Queues submissions on the device while offline and retries when connectivity returns.

## Architecture

- The app is completely separate from the main Ops Manager UI.
- `/api/jobs` reads directly from `jobs` joined to `clients`.
- `/api/timesheets` writes directly into `timesheets`, `timesheet_days`, and `timesheet_entries`.
- If `DATABASE_URL` is not configured, the UI falls back to demo jobs so the flow can still be tested.

## Environment

Copy `.env.example` to `.env.local` and set the database values:

```bash
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/SubStrata-OpsManager
MOBILE_JOB_ACTIVE_STATUSES=approved,active,on_hold
MOBILE_TIMESHEET_STATUS=submitted
```

This app is now aligned to the main Ops Manager schema you shared:

- `app_users`
- `clients`
- `jobs`
- `timesheets`
- `timesheet_days`
- `timesheet_entries`

## Database setup

An example schema is included at [db/mobile-timesheets.sql](/C:/Users/SeanTempleton/OneDrive%20-%20McMillan%20Drilling%20Ltd/Documents/GitHub/substrata-timesheets/db/mobile-timesheets.sql).

The SQL file now contains optional helper SQL for this mobile app on top of the existing Ops Manager schema, rather than a separate replacement table.

## Local development

```bash
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Important integration note

This app still leaves the existing Ops Manager application untouched, but submissions now land in the same normalized timesheet tables the main interface already uses. That means supervisor and manager review can happen in the existing workflow without needing a separate staging table.
