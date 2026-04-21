import { ZodError } from "zod";
import { NextResponse } from "next/server";

import { createTimesheetEntry } from "@/lib/submissions";
import { isDatabaseConfigured } from "@/lib/db";
import { timesheetPayloadSchema } from "@/lib/timesheets";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        { error: "DATABASE_URL is not configured for live submissions yet." },
        { status: 503 },
      );
    }

    const body = await request.json();
    const payload = timesheetPayloadSchema.parse(body);
    const record = await createTimesheetEntry(payload);

    return NextResponse.json({
      ok: true,
      record,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Timesheet submission is invalid.",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while saving the timesheet entry.",
      },
      { status: 500 },
    );
  }
}
