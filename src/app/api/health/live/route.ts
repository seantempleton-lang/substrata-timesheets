import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "substrata-timesheets",
    status: "live",
    nowUtc: new Date().toISOString(),
  });
}
