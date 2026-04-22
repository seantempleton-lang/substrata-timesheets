import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "SubStrata Field Timesheets",
  description:
    "Mobile-only timesheet capture for field crews, with project lookup and Postgres sync for supervisor review.",
  applicationName: "SubStrata Field Timesheets",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SubStrata Timesheets",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#efe4d2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-NZ">
      <body>{children}</body>
    </html>
  );
}
