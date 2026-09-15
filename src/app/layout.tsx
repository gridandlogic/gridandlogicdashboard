import type { Metadata } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL("https://gridandlogicdashboard.vercel.app"),
  title: "Grid & Logic",
  description: "Grid & Logic team dashboard — boards, channels, messages and meetings",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-neutral-950 text-white" suppressHydrationWarning>{children}</body>
    </html>
  );
}
