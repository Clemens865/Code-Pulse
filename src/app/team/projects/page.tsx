"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { I } from "../_components/icons";
import {
  AvatarStack,
  Badge,
  Btn,
  Chip,
  Sparkline,
  cell,
} from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";

const sparkPattern = [3, 5, 4, 7, 9, 6, 11, 8, 12, 14, 11, 17];

export default function ProjectListPage() {
  const { openPalette, persona } = useShell();
  const router = useRouter();
  const ps = persona.projects;

  return (
    <>
      <Topbar breadcrumbs={["Projects"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Projects
          </h1>
          <Badge kind="warn" icon={<I.flag />}>
            1 needs review
          </Badge>
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>
            Export CSV
          </Btn>
          <Btn kind="primary" icon={<I.plus />}>
            Bind project
          </Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Chip>
            <I.filter /> Filters
          </Chip>
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <Chip>
            Status <I.chevron />
          </Chip>
          <Chip>
            Redaction <I.chevron />
          </Chip>
          <Chip>
            Activity <I.chevron />
          </Chip>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>{ps.length} projects</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
              {["Project", "Members", "Sessions (7d)", "Activity", "Open blockers", "Last activity", "Redaction", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i >= 1 && i <= 4 ? "right" : "left",
                    fontWeight: 500,
                    fontSize: 11,
                    color: "var(--fg-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ps.map((p) => (
              <tr
                key={p.id}
                onClick={(e) => {
                  // Don't navigate when clicking nested interactive elements.
                  const t = e.target as HTMLElement;
                  if (t.closest("a, button")) return;
                  router.push(`/team/projects/${p.id}`);
                }}
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                <td style={cell({ left: true })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: `oklch(0.92 0.04 ${p.hue})`,
                        color: `oklch(0.35 0.13 ${p.hue})`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          color: "var(--fg-strong)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Link
                          href={`/team/projects/${p.id}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {p.name}
                        </Link>
                        {p.needsReview && (
                          <Badge kind="warn" icon={<I.flag />}>
                            Needs review
                          </Badge>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                        {p.repo}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={cell({ right: true })}>
                  <AvatarStack
                    ms={persona.members.filter((m) => m.projects.includes(p.id))}
                    max={4}
                  />
                </td>
                <td style={cell({ right: true, num: true })}>
                  <span style={{ fontWeight: 500 }}>{p.sessions7d}</span>
                </td>
                <td style={cell({ right: true })}>
                  <Sparkline
                    data={sparkPattern.map((v) => v * (p.sessions7d / 100))}
                    stroke={`oklch(0.55 0.13 ${p.hue})`}
                  />
                </td>
                <td style={cell({ right: true, num: true })}>
                  {p.blockers > 0 ? (
                    <Badge kind="err" icon={<I.blocker />}>
                      {p.blockers}
                    </Badge>
                  ) : (
                    <span style={{ color: "var(--fg-faint)" }}>—</span>
                  )}
                </td>
                <td style={cell({ num: true })}>
                  <span style={{ color: "var(--fg-muted)" }}>{p.lastActivity} ago</span>
                </td>
                <td style={cell({})}>
                  <Badge kind={p.redaction === "strict" ? "info" : "neutral"}>{p.redaction}</Badge>
                </td>
                <td style={cell({ pad: "6px 14px" })}>
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--fg-faint)",
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    <I.more />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
