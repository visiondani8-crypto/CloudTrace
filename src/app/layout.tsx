import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME || "CloudTrace";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Cloud incident intelligence and forensics — understand the failure, trace the evidence, protect the business.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0F16",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" data-theme="obsidian">
      <body>{children}</body>
    </html>
  );
}
