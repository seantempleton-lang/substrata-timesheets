import { MobileTimesheetApp } from "@/components/mobile-timesheet-app";
import { getCurrentEmployee } from "@/lib/auth";
import { getAppBootstrap } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [bootstrap, currentEmployee] = await Promise.all([
    getAppBootstrap(),
    getCurrentEmployee(),
  ]);

  return <MobileTimesheetApp bootstrap={bootstrap} initialEmployee={currentEmployee} />;
}
