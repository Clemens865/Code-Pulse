import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Pulse Team",
  description: "Multi-tenant SaaS dashboard for AI-assisted development teams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
