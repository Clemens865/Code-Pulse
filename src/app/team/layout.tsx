import "./tokens.css";
import type { Metadata } from "next";
import { TeamShell } from "./_components/shell";

export const metadata: Metadata = {
  title: "Claude Pulse Team",
  description:
    "Shared decisions, progress, and blockers across your team — feeding every developer's AI session.",
};

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <TeamShell>{children}</TeamShell>;
}
