import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

// This app is dynamic SSR everywhere (docs/DESIGN.md) — an authenticated CRUD
// app, never static export. Forcing it at the root also keeps `next build`
// from prerendering pages, which is what lets the build run with no env.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Asset Register",
  description: "Internal IT asset lifecycle management",
};

// suppressHydrationWarning is REQUIRED, not cosmetic: next-themes' inline
// script sets the `class` attribute on <html> before React hydrates, so the
// server and client markup always differ there. It suppresses that element's
// own attributes one level deep and does NOT mask mismatches anywhere below it.
//
// The ThemeProvider sits here rather than inside the (app) shell so /signin is
// themed too — a signed-out user gets no navigation, but they do get dark mode.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
