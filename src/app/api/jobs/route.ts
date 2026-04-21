import { NextResponse } from "next/server";

import { getAppBootstrap } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getAppBootstrap();
  return NextResponse.json(data);
}
