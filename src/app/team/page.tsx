"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { I } from "./_components/icons";
import { Avatar, AvatarStack, Badge, Btn, Sparkline } from "./_components/primitives";
import { Topbar } from "./_components/topbar";
import { Heatmap } from "./_components/heatmap";
import { useShell } from "./_components/shell";
import { api, type ApiOverviewReport } from "./_data/api";
import {
  lastNDaysActivity,
  memberById,
  memberWeekStats,
  orgDailyActivity,
  orgStats7d,
  projectById,
  projectWeekStats,
  type InsightTag,
} from "./_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
};

type Range = "24h" | "7d" | "30d" | "90d";
const RANGES: Range[] = ["24h", "7d", "30d", "90d"];
const RANGE_LABEL: Record<Range, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
};
const RANGE_SUB: Record<Range, string> = {
  "24h": "trailing 24h",
  "7d": "trailing 7d",
  "30d": "trailing 30d",
  "90d": "trailing 90d",
};

export default function OverviewPage() {
  const { openPalette, persona, insights, source } = useShell();
  const [live, setLive] = useState<ApiOverviewReport | null>(null);
  const [range, setRange] = useState<Range>("7d");

  useEffect(() => {
    if (source !== "live") {
      setLive(null);
      return;
    }
    let cancelled = false;
    api
      .reportsOverview(range)
      .then((r) => {
        if (!cancelled) setLive(r);
      })
      .catch(() => {
        if (!cancelled) setLive(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source, range]);

  const needsReview = persona.projects.filter((p) => p.needsReview);

  // Live overview wins when available; fall back to synthetic for sample mode.
  const stats = live
    ? {
        sessions: live.org.sessions7d,
        decisions: live.org.decisions7d,
        blockers: live.org.open_blockers,
        linesAdded: live.org.lines_added7d,
        linesRemoved: live.org.lines_removed7d,
        linesNet: live.org.lines_net7d,
        activeMembers: live.org.active_members7d,
      }
    : (() => {
        const s = orgStats7d(persona);
        return {
          sessions: s.sessions,
          decisions: s.decisions,
          blockers: s.blockers,
          linesAdded: s.linesAdded,
          linesRemoved: s.linesRemoved,
          linesNet: s.linesNet,
          activeMembers: s.activeMembers,
        };
      })();

  const orgSeries = live
    ? live.daily_activity.map((d) => ({ date: d.date, count: d.count }))
    : orgDailyActivity(persona);

  const projectSpark = (sessions: number) =>
    Array.from({ length: 12 }, (_, i) => Math.max(0, Math.round((sessions / 12) * (0.6 + 0.6 * Math.sin(i / 1.7) + (i / 12) * 0.4))));

  const topProjects = live
    ? live.top_projects.map((tp) => {
        const p = projectById(persona, tp.id) ?? {
          id: tp.id,
          name: tp.name,
          repo: "—",
          members: 0,
          sessions7d: tp.sessions7d,
          blockers: tp.open_blockers,
          lastActivity: "—",
          redaction: "standard" as const,
          needsReview: false,
          hue: 212,
        };
        return {
          p: { ...p, sessions7d: tp.sessions7d, blockers: tp.open_blockers },
          s: { sessions: tp.sessions7d, linesAdded: tp.lines_added, linesRemoved: tp.lines_removed },
        };
      })
    : persona.projects
        .filter((p) => !p.needsReview)
        .map((p) => ({ p, s: projectWeekStats(persona, p.id) }))
        .sort((a, b) => b.s.sessions - a.s.sessions)
        .slice(0, 5);

  const topContributors = live
    ? live.top_contributors.map((tc) => {
        const m = memberById(persona, tc.id) ?? {
          id: tc.id,
          name: tc.name,
          role: "Engineer" as const,
          init: tc.name.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase(),
          last: "—",
          hue: 212,
          projects: [],
          status: "active" as const,
        };
        return {
          m: { ...m, name: tc.name },
          s: { sessions: tc.sessions7d, linesAdded: tc.lines_added, linesRemoved: tc.lines_removed },
        };
      })
    : persona.members
        .filter((m) => m.status !== "invited")
        .map((m) => ({ m, s: memberWeekStats(persona, m.id) }))
        .sort((a, b) => b.s.sessions - a.s.sessions)
        .slice(0, 5);

  const recentInsights = insights.slice(0, 6);

  const kpis: Array<{ label: string; v: string; sub: string; spark: number[]; hue?: number }> = [
    { label: "Sessions", v: stats.sessions.toLocaleString(), sub: RANGE_SUB[range], spark: spark(orgSeries.slice(-12).map((d) => d.count)) },
    { label: "Decisions", v: stats.decisions.toLocaleString(), sub: RANGE_SUB[range], spark: [1, 2, 1, 3, 2, 3, 4, 3, 4, 3, 5, 4] },
    { label: "Blockers", v: stats.blockers.toLocaleString(), sub: stats.blockers > 0 ? "open" : "—", spark: [1, 1, 2, 1, 2, 2, 1, 3, 2, 2, 1, 2], hue: 28 },
    { label: "Lines net", v: signed(stats.linesNet), sub: `+${k(stats.linesAdded)} / −${k(stats.linesRemoved)}`, spark: spark(orgSeries.slice(-12).map((d) => d.count * 30)) },
    { label: "Members", v: `${stats.activeMembers}`, sub: RANGE_SUB[range], spark: [3, 4, 3, 4, 5, 4, 5, 5, 6, 5, 6, 6] },
  ];

  return (
    <>
      <Topbar breadcrumbs={["Overview"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {persona.org.name}
          </h1>
          <span style={{ fontSize: 12, color: "var(--fg-faint)" }}>{persona.org.plan}</span>
          <div
            role="tablist"
            aria-label="Time range"
            style={{
              display: "inline-flex",
              marginLeft: 8,
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {RANGES.map((r, i) => {
              const active = r === range;
              return (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setRange(r)}
                  style={{
                    padding: "5px 10px",
                    fontSize: 12,
                    fontFamily: "inherit",
                    background: active ? "var(--bg-active)" : "transparent",
                    color: active ? "var(--fg-strong)" : "var(--fg-muted)",
                    fontWeight: active ? 500 : 400,
                    border: "none",
                    borderLeft: i === 0 ? "none" : "1px solid var(--border)",
                    cursor: "pointer",
                  }}
                >
                  {RANGE_LABEL[r]}
                </button>
              );
            })}
          </div>
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>Export</Btn>
          <Link href="/team/reports" style={{ textDecoration: "none" }}>
            <Btn kind="secondary" icon={<I.reports />}>Reports</Btn>
          </Link>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          gridAutoRows: "min-content",
        }}
      >
        {needsReview.length > 0 && (
          <Link
            href="/team/admin/projects"
            style={{
              gridColumn: "1 / -1",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--accent-soft)",
              color: "var(--accent-soft-fg)",
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            <Badge kind="warn" icon={<I.flag />}>Needs review</Badge>
            <span>
              {needsReview.length} auto-created project{needsReview.length === 1 ? "" : "s"} awaiting confirmation
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ color: "var(--accent)", fontWeight: 500 }}>Review →</span>
          </Link>
        )}

        {kpis.map((c, i) => (
          <div
            key={i}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--fg-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {c.label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--fg-strong)", fontVariantNumeric: "tabular-nums" }}>
                {c.v}
              </div>
              <Sparkline data={c.spark} w={70} h={20} stroke={c.hue ? `oklch(0.6 0.16 ${c.hue})` : "var(--accent)"} />
            </div>
            <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}

        <section
          style={{
            gridColumn: "1 / -1",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "baseline",
              gap: 8,
            }}
          >
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Org-wide activity</h3>
            <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>across all projects · last 90 days</span>
          </div>
          <div style={{ padding: "16px 16px 18px" }}>
            <Heatmap days={orgSeries} hue={212} />
          </div>
        </section>

        <section
          style={{
            gridColumn: "1 / span 3",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Top projects</h3>
            <span style={{ flex: 1 }} />
            <Link href="/team/projects" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
              All projects →
            </Link>
          </div>
          <div>
            {topProjects.map(({ p, s }, idx) => (
              <Link
                key={p.id}
                href={`/team/projects/${p.id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px 1fr 110px 90px 110px 70px",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderBottom: idx < topProjects.length - 1 ? "1px solid var(--border)" : "none",
                  textDecoration: "none",
                  color: "inherit",
                  fontSize: 13,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: `oklch(0.65 0.13 ${p.hue})` }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--fg-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <code className="mono" style={{ fontSize: 11, color: "var(--fg-faint)" }}>{p.repo}</code>
                </div>
                <Sparkline data={projectSpark(s.sessions)} w={100} h={20} stroke={`oklch(0.6 0.13 ${p.hue})`} />
                <div style={{ fontSize: 12, color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {s.sessions.toLocaleString()} sessions
                </div>
                <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                  <span style={{ color: "oklch(0.55 0.13 145)" }}>+{k(s.linesAdded)}</span>
                  <span style={{ color: "var(--fg-faint)" }}> / </span>
                  <span style={{ color: "oklch(0.55 0.16 28)" }}>−{k(s.linesRemoved)}</span>
                </div>
                <div style={{ fontSize: 12, color: p.blockers > 0 ? "oklch(0.55 0.16 28)" : "var(--fg-faint)", textAlign: "right" }}>
                  {p.blockers > 0 ? `${p.blockers} blocker${p.blockers === 1 ? "" : "s"}` : "—"}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section
          style={{
            gridColumn: "4 / span 2",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Top contributors</h3>
            <span style={{ flex: 1 }} />
            <Link href="/team/members" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
              All members →
            </Link>
          </div>
          <div>
            {topContributors.map(({ m, s }, idx) => (
              <div
                key={m.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr auto",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderBottom: idx < topContributors.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: 13,
                }}
              >
                <Avatar m={m} size={22} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m.name}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                    {m.role} · {s.sessions} session{s.sessions === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  <span style={{ color: "oklch(0.55 0.13 145)" }}>+{k(s.linesAdded)}</span>
                  <span style={{ color: "var(--fg-faint)" }}> / </span>
                  <span style={{ color: "oklch(0.55 0.16 28)" }}>−{k(s.linesRemoved)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            gridColumn: "1 / -1",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
          }}
        >
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Recent insights</h3>
            <span style={{ flex: 1 }} />
            <Link href="/team/insights" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
              View all →
            </Link>
          </div>
          <div>
            {recentInsights.map((it, idx) => {
              const m = memberById(persona, it.member);
              const p = projectById(persona, it.project);
              const tm = TAG_MAP[it.type];
              return (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr 200px auto",
                    gap: 12,
                    padding: "10px 14px",
                    borderBottom: idx < recentInsights.length - 1 ? "1px solid var(--border)" : "none",
                    alignItems: "start",
                  }}
                >
                  <Badge kind={tm[0]} icon={tm[1]()}>{tm[2]}</Badge>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-strong)" }}>{it.title}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.45 }}>{it.text}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-muted)", minWidth: 0 }}>
                    {p && <span style={{ width: 8, height: 8, borderRadius: 2, background: `oklch(0.65 0.13 ${p.hue})` }} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name ?? it.project}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "var(--fg-faint)" }}>
                    {m && <Avatar m={m} size={18} />}
                    <span>{it.t} ago</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

function k(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function signed(n: number): string {
  if (n > 0) return `+${k(n)}`;
  if (n < 0) return `−${k(Math.abs(n))}`;
  return "0";
}

function spark(data: number[]): number[] {
  if (data.length === 0) return [0, 0, 0, 0];
  return data;
}
