import { MobileTimesheetApp } from "@/components/mobile-timesheet-app";
import { getAppBootstrap } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const bootstrap = await getAppBootstrap();

  return <MobileTimesheetApp bootstrap={bootstrap} />;
}
