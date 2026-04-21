import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SubStrata Field Timesheets",
    short_name: "Timesheets",
    description: "Mobile-only field timesheet capture with offline queueing.",
    start_url: "/",
    display: "standalone",
    background_color: "#efe4d2",
    theme_color: "#efe4d2",
    lang: "en-NZ",
  };
}
