# SubStrata Field Timesheets Application Guide

## Overview

SubStrata Field Timesheets is a mobile-first Next.js application for McMillan Drilling field crews to submit daily timesheet entries into the existing SubStrata Ops Manager Postgres database.

The application is intentionally separate from the main Ops Manager user interface, but it writes to the same normalized timesheet tables. Its main job is to give field staff a small, phone-friendly workflow for logging worked time, leave, overnight allowances, and job-specific notes while preserving the review path already used by supervisors and managers.

## Technology Stack

| Area | Implementation |
| --- | --- |
| Framework | Next.js 16.2.4 App Router |
| UI | React 19.2.4 client component with CSS Modules |
| Language | TypeScript |
| Validation | Zod 4 |
| Database client | `postgres` |
| Database | Postgres, shared with SubStrata Ops Manager |
| Deployment | Docker standalone Next.js output |
| Runtime | Node.js route handlers |

The repository includes a local `AGENTS.md` note requiring agents to consult the bundled Next.js docs before code changes. The current app follows the App Router file conventions described in `node_modules/next/dist/docs/`: `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/manifest.ts`, and `src/app/api/**/route.ts`.

## Repository Layout

```text
.
|-- db/
|   `-- mobile-timesheets.sql
|-- public/
|-- src/
|   |-- app/
|   |   |-- api/
|   |   |   |-- auth/login/route.ts
|   |   |   |-- auth/logout/route.ts
|   |   |   |-- health/db/route.ts
|   |   |   |-- health/live/route.ts
|   |   |   |-- jobs/route.ts
|   |   |   `-- timesheets/route.ts
|   |   |-- globals.css
|   |   |-- layout.tsx
|   |   |-- manifest.ts
|   |   `-- page.tsx
|   |-- components/
|   |   |-- mobile-timesheet-app.module.css
|   |   `-- mobile-timesheet-app.tsx
|   `-- lib/
|       |-- auth.ts
|       |-- db.ts
|       |-- jobs.ts
|       |-- submissions.ts
|       |-- timesheets.ts
|       `-- types.ts
|-- Dockerfile
|-- next.config.ts
|-- package.json
`-- README.md
```

## Application Entry Point

`src/app/page.tsx` is the only page route. It is marked `force-dynamic` so each request can read live database/session state.

On render it loads two pieces of server-side bootstrap data in parallel:

- `getAppBootstrap()` from `src/lib/jobs.ts`, which loads active jobs or returns demo data.
- `getCurrentEmployee()` from `src/lib/auth.ts`, which resolves the current employee from the session cookie.

Those values are passed into the client component `MobileTimesheetApp`.

## User Experience

The app is designed as a single narrow handset layout. The first screen shows:

- The SubStrata Field Timesheets heading and McMillan Drilling branding.
- Online/offline state.
- A refresh button for live job data.
- A status panel showing database, sync, auth, or submission messages.

If no employee is signed in, the app shows a login form. Once signed in, the user sees:

- Signed-in personnel profile.
- Local sync queue status.
- Current and previous week timesheet history.
- A day-sheet form.
- Work rows or leave details, depending on day type.
- Overnight allowance toggle.
- Whole-day notes.
- A fixed submit bar with paid-hour total.

## Authentication

Authentication is implemented in `src/lib/auth.ts` and the auth route handlers.

### Account Model

Mobile sign-in accounts are stored in `mobile_auth_accounts` and linked to existing `app_users` rows. A mobile account includes:

- `user_id`, referencing `app_users.id`.
- `login_email`.
- `password_hash`.
- `is_active`.
- login and audit timestamps.

Only active mobile accounts linked to active app users can authenticate.

### Passwords

Passwords are verified with `scrypt` hashes in this format:

```text
scrypt$<salt>$<hex-derived-key>
```

Verification uses `timingSafeEqual` to compare the derived key against the stored key.

### Sessions

Successful login creates a random 32-byte token. The raw token is sent only to the browser as an HTTP-only cookie named:

```text
substrata_timesheet_session
```

The database stores only a SHA-256 hash of the token in `mobile_auth_sessions`.

Session behavior:

- Default duration is 30 days.
- Cookies are HTTP-only.
- Cookies use `sameSite: "lax"`.
- Cookies are `secure` in production.
- Logout revokes the matching database session and clears the cookie.
- Session lookup updates `last_seen_at`.

## Job Bootstrap

Jobs are loaded by `listJobs()` in `src/lib/jobs.ts`.

The query reads from:

- `jobs`
- `clients`

It returns active job options containing:

- job ID
- job number/code
- job title/name
- client name
- site name
- active flag

The set of visible statuses is controlled by:

```text
MOBILE_JOB_ACTIVE_STATUSES=approved,active,on_hold
```

If `DATABASE_URL` is missing, or the database lookup fails during bootstrap, the app falls back to demo jobs defined in `src/lib/timesheets.ts`. In that mode the UI remains testable, but live sign-in and live submissions are unavailable.

## Timesheet Workflow

The app records one day at a time. Supported day types are:

- Worked time
- Annual leave
- Sick leave
- Unpaid leave

For worked time, users can add multiple time rows. Each row captures:

- job
- start time
- finish time
- job description or working-with notes

For leave, users choose leave hours directly. Quick options are 4, 8, 10, and 12 hours, with a numeric input allowing quarter-hour increments.

## Time Rules

Time and validation rules live primarily in `src/lib/timesheets.ts`.

Important constants:

```text
APP_TIME_ZONE=Pacific/Auckland
TIME_STEP_MINUTES=15
MANDATORY_LUNCH_BREAK_HOURS=0.5
```

Worked-time rules:

- Start and finish times must use `HH:mm`.
- Times must be on 15-minute boundaries.
- Finish time must be later than start time.
- A day must include at least one work row.
- Rows cannot overlap.
- A mandatory 0.5 hour unpaid lunch deduction is enforced.
- Paid hours must exactly match calculated worked time minus lunch.
- The day must still have positive paid time after the lunch deduction.

Leave rules:

- Leave entries must include leave hours.
- Leave entries cannot include work rows.
- Leave hours must be between 0.25 and 24.

Notes are trimmed and limited to 500 characters.

## Submission Data Flow

The browser builds a `TimesheetPayload` and posts it to:

```text
POST /api/timesheets
```

The API route:

1. Requires `DATABASE_URL`.
2. Requires an authenticated employee session.
3. Overrides submitted employee identity with the authenticated employee.
4. Validates the payload with Zod.
5. Calls `createTimesheetEntry()`.

`createTimesheetEntry()` writes inside a database transaction:

1. Finds the active `app_users` employee.
2. Upserts the weekly `timesheets` row by `(user_id, week_start)`.
3. Upserts the `timesheet_days` row by `(timesheet_id, work_date)`.
4. Deletes existing entries for that day.
5. Inserts fresh `timesheet_entries`.
6. Reads `timesheet_totals_v`.
7. Updates weekly `total_hours` and `total_overnights`.

If the submitted day already exists in the week, the app replaces that day's entries instead of duplicating them.

## Database Tables and Views

The app expects the main Ops Manager database to provide:

- `app_users`
- `clients`
- `jobs`
- `timesheets`
- `timesheet_days`
- `timesheet_entries`
- `timesheet_totals_v`

The helper SQL in `db/mobile-timesheets.sql` adds mobile-specific auth support:

- `mobile_auth_accounts`
- `mobile_auth_sessions`
- indexes for session lookup
- updated-at trigger on mobile auth accounts
- an example seeded mobile account for `rahulnegi@drilling.co.nz`
- `jobs_mobile_lookup_vw`

The application code currently queries `jobs` and `clients` directly rather than using `jobs_mobile_lookup_vw`.

## Offline Queueing

Offline support is implemented in the client component with `localStorage`.

Queue storage key:

```text
substrata.mobile.pending-timesheets.v1
```

Queue behavior:

- If the browser is offline, submissions are saved locally.
- If a live submission fails, the payload is also saved locally.
- The app listens for browser `online` and `offline` events.
- Queue state is refreshed on storage events and visibility changes.
- When online and signed in, queued entries are retried automatically.
- Users can manually trigger queue sync from the status panel.
- Pending entries remain on the device after logout and sync only after the user logs back in.

The queue stores the full validated client payload plus a local queue ID and queued timestamp. Server-side authentication still controls who can submit when the queued payload is eventually posted.

## Timesheet History

Authenticated users can load recent timesheet history through:

```text
GET /api/timesheets
```

The server returns current and previous weekly periods based on the New Zealand date. For each period the response includes:

- week start and end
- status
- submitted timestamp
- total hours
- overnight count
- days
- entries per day

The UI displays the current and previous periods, including daily totals, overnight flags, entry rows, and notes.

## API Routes

| Route | Method | Purpose | Auth Required |
| --- | --- | --- | --- |
| `/api/auth/login` | `POST` | Validate email/password and create session cookie | No |
| `/api/auth/logout` | `POST` | Revoke current session and clear cookie | Cookie optional |
| `/api/jobs` | `GET` | Return live or demo app bootstrap data | No |
| `/api/timesheets` | `GET` | Return current and previous week history | Yes |
| `/api/timesheets` | `POST` | Submit or update a day sheet | Yes |
| `/api/health/live` | `GET` | Lightweight process liveness check | No |
| `/api/health/db` | `GET` | Database readiness and count check | No |

All API route handlers use the Node.js runtime.

## Health Checks

`/api/health/live` returns a simple JSON response confirming the app process is live.

`/api/health/db` verifies database configuration and connectivity. It returns:

- `503` if `DATABASE_URL` is not configured.
- `500` if connection or queries fail.
- `200` with database name, UTC timestamp, and counts when successful.

The Dockerfile uses `/api/health/live` for the container `HEALTHCHECK`.

## Environment Variables

Required for live operation:

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/SubStrata-OpsManager
```

Optional behavior:

```text
MOBILE_JOB_ACTIVE_STATUSES=approved,active,on_hold
MOBILE_TIMESHEET_STATUS=submitted
```

`MOBILE_TIMESHEET_STATUS` controls the status written to the weekly `timesheets` row when a mobile day sheet is submitted.

## Progressive Web App Metadata

The app includes `src/app/manifest.ts`, which generates a web app manifest with:

- app name: SubStrata Field Timesheets
- short name: Timesheets
- standalone display mode
- New Zealand language setting
- matching background and theme colors

`src/app/layout.tsx` also defines metadata, Apple web app options, viewport settings, and theme color.

## Styling

The UI uses:

- `src/app/globals.css` for global reset, font stack, and base colors.
- `src/components/mobile-timesheet-app.module.css` for the handset layout and all screen components.

The design is intentionally phone-sized, with a maximum content width of 430px. The visual treatment uses warm earth tones, rounded panels, compact summaries, and large touch targets for field use.

## Build and Deployment

`next.config.ts` sets:

```ts
output: "standalone"
```

The Dockerfile has three main stages:

1. Install dependencies with `npm ci`.
2. Build the Next.js standalone app.
3. Run the standalone server with Node on port 3000.

Container settings:

- Base image: `node:24-alpine`
- Runtime command: `node server.js`
- Exposed port: `3000`
- Health check: `http://127.0.0.1:3000/api/health/live`

## Local Development

Install dependencies:

```bash
npm.cmd install
```

Run the dev server:

```bash
npm.cmd run dev
```

Open:

```text
http://localhost:3000
```

Without `DATABASE_URL`, the UI uses demo jobs and shows a demo/fallback status message. Live login, live history, and live submissions require database access.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the production app |
| `npm run start` | Start the production Next.js server |
| `npm run lint` | Run ESLint |

## Operational Notes

- The app does not create or modify the main Ops Manager UI.
- The mobile app writes directly to the shared normalized timesheet tables.
- Submitting a day that already exists updates that day rather than creating duplicate daily rows.
- Supervisor and manager approvals are cleared when a weekly timesheet is updated through mobile submission.
- Demo mode is only a UI fallback and does not permit live submissions.
- Offline queueing is device-local. Clearing browser storage will remove pending queued day sheets.
- Queued submissions require the user to be signed in when sync occurs.

## Known Boundaries

- There is no automated test suite in the current repository.
- There is no service worker; offline behavior is local queueing, not full offline app shell caching.
- Job lookup is direct against `jobs` and `clients`, despite the helper SQL also defining `jobs_mobile_lookup_vw`.
- The SQL helper seeds one example mobile auth account and assumes the referenced `app_users` record already exists.
- The app assumes `timesheet_totals_v` exists in the target database for weekly total recalculation.
