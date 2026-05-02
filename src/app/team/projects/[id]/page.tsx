"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { I } from "../../_components/icons";
import { Avatar, Badge, Sparkline } from "../../_components/primitives";
import { Heatmap } from "../../_components/heatmap";
import { useShell } from "../../_components/shell";
import { api } from "../../_data/api";
import { lastNDaysActivity, memberById, projectById, type InsightTag } from "../../_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
};

type DetailResp = Awaited<ReturnType<typeof api.project>>;

export default function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { persona, insights: allInsights } = useShell();
  const p = projectById(persona, id) ?? {
    id,
    name: "Project",
    repo: "—",
    members: 0,
    sessions7d: 0,
    blockers: 0,
    lastActivity: "—",
    redaction: "standard" as const,
    needsReview: false,
    hue: 212,
  };

  const [detail, setDetail] = useState<DetailResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.project(id).then((d) => {
      if (!cancelled) setDetail(d);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Prefer live data; fall back to sample-derived insights and an empty hot-files list.
  const projInsights =
    detail?.recent_insights.map((i) => ({
      type: i.type,
      project: id,
      member: i.member_id,
      t: relativeTime(i.created_at),
      title: i.title || i.content.slice(0, 80),
      text: i.content,
    })) ?? allInsights.filter((i) => i.project === p.id).slice(0, 4);

  const hotFiles =
    detail?.hot_files && detail.hot_files.length > 0
      ? detail.hot_files
      : [
          { path: "—", edits: 0 },
        ];

  const cards: Array<{
    label: string;
    v: number | string;
    sub: string;
    spark: number[];
    hue?: number;
  }> = [
    { label: "Sessions", v: p.sessions7d, sub: "trailing 7d", spark: [3, 5, 4, 7, 9, 6, 11, 8, 12, 14, 11, 17] },
    { label: "Decisions", v: projInsights.filter((i) => i.type === "decision").length, sub: "recent", spark: [1, 2, 1, 3, 2, 3, 4, 3, 4, 3, 5, 4] },
    { label: "Blockers", v: p.blockers, sub: p.blockers > 0 ? "open" : "—", spark: [1, 1, 2, 1, 2, 2, 1, 3, 2, 2, 1, 2], hue: 28 },
    { label: "Hot files", v: detail?.hot_files.length ?? 0, sub: "tracked", spark: [10, 12, 8, 15, 13, 18, 14, 22, 17, 20, 15, 21] },
  ];

  return (
    <div
      style={{
        flex: 1,
        overflow: "auto",
        padding: 24,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 12,
        gridAutoRows: "min-content",
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--fg-strong)",
              }}
            >
              {c.v}
            </div>
            <Sparkline
              data={c.spark}
              w={70}
              h={20}
              stroke={c.hue ? `oklch(0.6 0.16 ${c.hue})` : "var(--accent)"}
            />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>{c.sub}</div>
        </div>
      ))}

      <ActivitySection projectId={id} hue={p.hue} />


      <section
        style={{
          gridColumn: "1 / span 3",
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
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Recent insights</h3>
          <span style={{ flex: 1 }} />
          <Link
            href={`/team/projects/${id}/insights`}
            style={{
              fontSize: 12,
              color: "var(--accent)",
              textDecoration: "none",
              fontWeight: 500,
            }}
          >
            View all →
          </Link>
        </div>
        <div>
          {projInsights.length === 0 ? (
            <div style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
              No insights yet. Wrap a session with a PROGRESS / DECISION / BLOCKED summary to populate.
            </div>
          ) : (
            projInsights.map((it, idx) => {
              const m = memberById(persona, it.member);
              const tm = TAG_MAP[it.type];
              return (
                <div
                  key={idx}
                  style={{
                    padding: "10px 14px",
                    borderBottom:
                      idx < projInsights.length - 1 ? "1px solid var(--border)" : "none",
                    display: "grid",
                    gridTemplateColumns: "110px 1fr auto",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  <Badge kind={tm[0]} icon={tm[1]()}>
                    {tm[2]}
                  </Badge>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg-strong)" }}>
                      {it.title}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2, lineHeight: 1.45 }}>
                      {it.text}
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11.5,
                      color: "var(--fg-faint)",
                    }}
                  >
                    {m && <Avatar m={m} size={18} />}
                    <span>{it.t} ago</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section
        style={{
          gridColumn: "4 / span 1",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Hotspot files</h3>
          <div style={{ fontSize: 11, color: "var(--fg-faint)", marginTop: 2 }}>
            Most touched
          </div>
        </div>
        <div>
          {detail?.hot_files && detail.hot_files.length > 0 ? (
            detail.hot_files.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 14px",
                  borderBottom:
                    i < detail.hot_files.length - 1 ? "1px solid var(--border)" : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <code
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--fg-muted)",
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {f.path}
                </code>
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--fg-faint)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {f.edits}
                </span>
              </div>
            ))
          ) : (
            <div style={{ padding: 14, color: "var(--fg-faint)", fontSize: 12 }}>
              No edits tracked yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ActivitySection({ projectId, hue }: { projectId: string; hue: number }) {
  const days = lastNDaysActivity("project", projectId);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const past = days.filter((d) => d.date <= todayIso);

  const total = past.reduce((acc, d) => acc + d.count, 0);
  const activeDays = past.filter((d) => d.count > 0).length;

  const dowTotals = [0, 0, 0, 0, 0, 0, 0];
  const dowDays = [0, 0, 0, 0, 0, 0, 0];
  for (const d of past) {
    const [y, m, dd] = d.date.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    dowTotals[dow] += d.count;
    dowDays[dow] += 1;
  }
  let busiestDow = 0;
  let busiestAvg = 0;
  for (let i = 0; i < 7; i++) {
    const avg = dowDays[i] > 0 ? dowTotals[i] / dowDays[i] : 0;
    if (avg > busiestAvg) {
      busiestAvg = avg;
      busiestDow = i;
    }
  }

  let streak = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    if (past[i].count > 0) streak += 1;
    else break;
  }

  const stats: Array<{ label: string; v: string | number; sub?: string }> = [
    { label: "Sessions", v: total.toLocaleString(), sub: "last 90d" },
    { label: "Active days", v: activeDays, sub: `of ${past.length}` },
    { label: "Busiest day", v: WEEKDAYS[busiestDow], sub: `${busiestAvg.toFixed(1)} avg` },
    { label: "Current streak", v: streak, sub: streak === 1 ? "day" : "days" },
  ];

  return (
    <section
      style={{
        gridColumn: "1 / span 4",
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
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Activity</h3>
        <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>last 90 days</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, auto) 1fr",
          gap: 24,
          padding: "16px 16px 18px",
          alignItems: "start",
        }}
      >
        <Heatmap days={days} hue={hue} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            alignSelf: "stretch",
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "10px 12px",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--fg-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: "var(--fg-strong)",
                  letterSpacing: "-0.02em",
                  marginTop: 4,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.v}
              </div>
              {s.sub && (
                <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 2 }}>{s.sub}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
