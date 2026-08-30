"use client";

import { Fragment, useEffect, useState } from "react";
import { I } from "../_components/icons";
import { Avatar, Badge, Btn, Chip, cell } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { api, type ApiWeeklyReport } from "../_data/api";

const FALLBACK: ApiWeeklyReport = {
  range: { start: "", end: "" },
  summary: {
    sessions: { value: 287, delta_pct: 18 },
    decisions: { value: 41, delta_pct: 12 },
    blockers: { value: 7, delta_abs: -2 },
    lines_changed: { value: "12.4k", delta_pct: 9 },
    members_active: { value: "6/8", delta_abs: 0 },
  },
  heatmap: { days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], members: [] },
  by_project: [],
};

function formatRange(start: string, end: string) {
  if (!start || !end) return "Apr 26 – May 02 · all projects";
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)} · all projects`;
}

function summaryDelta(field: { delta_pct?: number; delta_abs?: number }) {
  if (typeof field.delta_pct === "number") {
    if (field.delta_pct === 0) return { label: "—", k: "neutral" as const };
    const sign = field.delta_pct > 0 ? "+" : "";
    return {
      label: `${sign}${field.delta_pct}%`,
      k: field.delta_pct >= 0 ? ("ok" as const) : ("neutral" as const),
    };
  }
  if (typeof field.delta_abs === "number") {
    if (field.delta_abs === 0) return { label: "—", k: "neutral" as const };
    const sign = field.delta_abs > 0 ? "+" : "−";
    return {
      label: `${sign}${Math.abs(field.delta_abs)}`,
      k: field.delta_abs >= 0 ? ("ok" as const) : ("neutral" as const),
    };
  }
  return { label: "—", k: "neutral" as const };
}

export default function ReportsPage() {
  const { openPalette, persona } = useShell();
  const [report, setReport] = useState<ApiWeeklyReport>(FALLBACK);
  const [source, setSource] = useState<"sample" | "live">("sample");

  useEffect(() => {
    let cancelled = false;
    api
      .reportsWeekly()
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setSource("live");
      })
      .catch(() => {
        if (!cancelled) setSource("sample");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards: Array<{ label: string; value: string | number; delta: ReturnType<typeof summaryDelta> }> = [
    { label: "Sessions",       value: report.summary.sessions.value,         delta: summaryDelta(report.summary.sessions) },
    { label: "Decisions",      value: report.summary.decisions.value,        delta: summaryDelta(report.summary.decisions) },
    { label: "Blockers",       value: report.summary.blockers.value,         delta: summaryDelta(report.summary.blockers) },
    { label: "Lines changed",  value: report.summary.lines_changed.value,    delta: summaryDelta(report.summary.lines_changed) },
    { label: "Members active", value: report.summary.members_active.value,   delta: summaryDelta(report.summary.members_active) },
  ];

  const heatmapMembers =
    report.heatmap.members.length > 0
      ? report.heatmap.members
      : persona.members.slice(0, 7).map((m, i) => ({
          id: m.id,
          name: m.name,
          cells: Array.from({ length: 7 }, (_, j) => Math.round(((i * 7 + j * 13) % 23) / 23 * 5)),
          total: 20 + i * 7 + (i % 3) * 4,
        }));

  const projectRows =
    report.by_project.length > 0
      ? report.by_project
      : persona.projects
          .filter((p) => !p.needsReview)
          .slice(0, 3)
          .map((p, i) => ({
            project_id: p.id,
            project_name: p.name,
            sessions: p.sessions7d,
            decisions: [14, 9, 8][i] ?? 0,
            blockers: p.blockers,
            lines_changed: ["4.2k", "2.8k", "1.9k"][i] ?? "—",
            top_contributor_id:
              persona.members.find((m) => m.projects.includes(p.id))?.id ?? null,
          }));

  const memberById = (id: string) => persona.members.find((m) => m.id === id);
  const projectHue = (id: string) => persona.projects.find((p) => p.id === id)?.hue ?? 212;

  const maxCell = Math.max(
    1,
    ...heatmapMembers.flatMap((m) => m.cells),
  );

  return (
    <>
      <Topbar breadcrumbs={["Reports", "Weekly"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Weekly report
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
            {formatRange(report.range.start, report.range.end)}
          </span>
          {source === "sample" && (
            <Badge kind="warn">Sample data</Badge>
          )}
          <span style={{ flex: 1 }} />
          <Btn kind="ghost">Configure</Btn>
          <Btn kind="secondary" icon={<I.download />}>
            Export CSV
          </Btn>
          <Btn kind="primary">Send to client</Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Chip hasValue>
            This week <I.chevron />
          </Chip>
          <Chip>
            All projects <I.chevron />
          </Chip>
          <Chip>
            All members <I.chevron />
          </Chip>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {cards.map((c, i) => (
            <div
              key={i}
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--fg-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {c.label}
              </div>
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "var(--fg-strong)",
                  marginTop: 4,
                }}
              >
                {c.value}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: c.delta.k === "ok" ? "oklch(0.55 0.13 145)" : "var(--fg-muted)",
                  marginTop: 2,
                }}
              >
                {c.delta.label} vs prev
              </div>
            </div>
          ))}
        </div>

        <section
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
              Activity by member × day
            </h3>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>session count</span>
          </div>
          <div style={{ padding: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "120px repeat(7, 1fr) 60px",
                gap: 4,
                alignItems: "center",
                fontSize: 11,
              }}
            >
              <div />
              {report.heatmap.days.map((d) => (
                <div key={d} style={{ color: "var(--fg-faint)", textAlign: "center" }}>
                  {d}
                </div>
              ))}
              <div style={{ color: "var(--fg-faint)", textAlign: "right" }}>Total</div>
              {heatmapMembers.slice(0, 7).map((row) => {
                const m = memberById(row.id);
                return (
                  <Fragment key={row.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "var(--fg)",
                        fontSize: 12,
                      }}
                    >
                      {m && <Avatar m={m} size={18} />} {row.name}
                    </div>
                    {row.cells.slice(0, 7).map((v, j) => {
                      const intensity = Math.min(1, v / maxCell);
                      return (
                        <div
                          key={j}
                          style={{
                            height: 22,
                            borderRadius: 3,
                            background:
                              intensity < 0.1
                                ? "var(--bg-muted)"
                                : `color-mix(in oklch, var(--accent) ${Math.round(intensity * 90 + 10)}%, var(--bg))`,
                            border: "1px solid var(--border)",
                          }}
                        />
                      );
                    })}
                    <div
                      style={{
                        textAlign: "right",
                        color: "var(--fg-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.total}
                    </div>
                  </Fragment>
                );
              })}
              {heatmapMembers.length === 0 && (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    padding: "16px 8px",
                    color: "var(--fg-faint)",
                    fontSize: 12,
                  }}
                >
                  No activity in this range yet.
                </div>
              )}
            </div>
          </div>
        </section>

        <section
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>By project</h3>
          </div>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                {["Project", "Sessions", "Decisions", "Blockers", "Lines", "Top contributor"].map(
                  (h, i) => (
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {projectRows.map((row, i) => {
                const top = row.top_contributor_id
                  ? memberById(row.top_contributor_id)
                  : undefined;
                return (
                  <tr
                    key={row.project_id}
                    style={{
                      borderBottom:
                        i < projectRows.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <td style={cell({})}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: `oklch(0.65 0.13 ${projectHue(row.project_id)})`,
                          }}
                        />
                        <span style={{ fontWeight: 500 }}>{row.project_name}</span>
                      </div>
                    </td>
                    <td style={cell({ right: true, num: true })}>{row.sessions}</td>
                    <td style={cell({ right: true, num: true })}>{row.decisions}</td>
                    <td style={cell({ right: true, num: true })}>
                      {row.blockers > 0 ? (
                        <span style={{ color: "oklch(0.55 0.16 28)" }}>{row.blockers}</span>
                      ) : (
                        <span style={{ color: "var(--fg-faint)" }}>—</span>
                      )}
                    </td>
                    <td style={cell({ right: true, num: true })}>{row.lines_changed}</td>
                    <td style={cell({})}>
                      {top ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <Avatar m={top} size={18} />{" "}
                          <span style={{ fontSize: 12 }}>{top.name}</span>
                        </span>
                      ) : (
                        <Badge kind="neutral">—</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {projectRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
                    No projects with activity in this range yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
