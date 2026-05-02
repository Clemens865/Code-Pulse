"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { I } from "../../_components/icons";
import { AvatarStack, Badge, Btn } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { projectById } from "../../_data/sample";

const TABS = [
  { label: "Overview", path: "" },
  { label: "Timeline", path: "/timeline" },
  { label: "Insights", path: "/insights" },
  { label: "Members", path: "/members" },
  { label: "Files", path: "/files" },
  { label: "Settings", path: "/settings" },
] as const;

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname() ?? "";
  const { openPalette, persona } = useShell();

  const found = projectById(persona, id);
  // The persona may still be loading (sample fallback) — render with a
  // placeholder header rather than 404'ing during SSR. Pages below fetch
  // their own data; if the project genuinely doesn't exist, those fetches
  // will surface the error.
  const p =
    found ??
    ({
      id,
      name: "Project",
      repo: "—",
      members: 0,
      sessions7d: 0,
      blockers: 0,
      lastActivity: "—",
      redaction: "standard",
      needsReview: false,
      hue: 212,
    } as const);

  const projMembers = persona.members.filter((m) => m.projects.includes(p.id));
  const base = `/team/projects/${id}`;

  return (
    <>
      <Topbar breadcrumbs={["Projects", p.name]} onOpenPalette={openPalette} />
      <div style={{ padding: "20px 24px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 7,
              background: `oklch(0.92 0.04 ${p.hue})`,
              color: `oklch(0.35 0.13 ${p.hue})`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            {p.name.charAt(0).toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {p.name}
              </h1>
              <Badge
                kind="ok"
                icon={<span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
              >
                Active
              </Badge>
              <Badge kind="neutral">{p.redaction} redaction</Badge>
              {p.needsReview && (
                <Badge kind="warn" icon={<I.flag />}>
                  Needs review
                </Badge>
              )}
            </div>
            <div
              style={{
                marginTop: 4,
                color: "var(--fg-muted)",
                fontSize: 12.5,
                display: "flex",
                gap: 14,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {p.repo} <I.external />
              </span>
              <span>·</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <AvatarStack ms={projMembers} max={4} size={18} /> {projMembers.length} members
              </span>
              <span>·</span>
              <span>last activity {p.lastActivity} ago</span>
            </div>
          </div>
          <Btn kind="ghost" icon={<I.download />}>
            Export
          </Btn>
          <Btn kind="secondary">Project settings</Btn>
        </div>
        <div style={{ display: "flex", gap: 0, marginTop: 16, marginBottom: -1 }}>
          {TABS.map((t) => {
            const href = base + t.path;
            const active =
              t.path === "" ? pathname === base : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={t.label}
                href={href}
                style={{
                  padding: "8px 14px",
                  fontSize: 12.5,
                  color: active ? "var(--fg-strong)" : "var(--fg-muted)",
                  fontWeight: active ? 500 : 400,
                  textDecoration: "none",
                  borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      {children}
    </>
  );
}
