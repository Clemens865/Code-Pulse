"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { I } from "../_components/icons";
import { Avatar, Badge, Btn } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { FilterDropdown, FilterRangeChip } from "../_components/filter-dropdown";
import { adaptApiTimeline, api } from "../_data/api";
import { memberById, projectById, type InsightTag, type TimelineEvent } from "../_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok" | "info" | "neutral", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
  pattern: ["info", () => <I.insights />, "Pattern"],
  fix: ["neutral", () => <I.insights />, "Fix"],
  context: ["neutral", () => <I.insights />, "Context"],
};

type Range = "24h" | "7d" | "30d" | "90d";

const RANGE_OPTIONS: Array<{ id: Range; label: string }> = [
  { id: "24h", label: "Last 24h" },
  { id: "7d", label: "Last 7d" },
  { id: "30d", label: "Last 30d" },
  { id: "90d", label: "Last 90d" },
];

const TYPE_OPTIONS = [
  { id: "session.start", label: "Session start" },
  { id: "session.end", label: "Session end" },
  { id: "insight.decision", label: "Decision" },
  { id: "insight.blocker", label: "Blocker" },
  { id: "insight.progress", label: "Progress" },
  { id: "insight.pattern", label: "Pattern" },
  { id: "insight.fix", label: "Fix" },
  { id: "insight.context", label: "Context" },
  { id: "tool.edit", label: "Edit" },
  { id: "tool.write", label: "Write" },
  { id: "tool.bash", label: "Bash" },
  { id: "tool.read", label: "Read" },
  { id: "tool.agent", label: "Agent" },
  { id: "tool.skill", label: "Skill" },
  { id: "tool.web_fetch", label: "WebFetch" },
  { id: "tool.web_search", label: "WebSearch" },
];

export default function TimelinePage() {
  const { openPalette, persona, timeline: shellEvents, source } = useShell();

  const [projects, setProjects] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [range, setRange] = useState<Range>("24h");

  const [liveEvents, setLiveEvents] = useState<TimelineEvent[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Refetch the timeline whenever any filter changes (live mode only).
  useEffect(() => {
    if (source !== "live") {
      setLiveEvents(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .timeline({ limit: 200, projects, members, kinds, range })
      .then((r) => {
        if (!cancelled) setLiveEvents(adaptApiTimeline(r.events));
      })
      .catch(() => {
        if (!cancelled) setLiveEvents(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, projects, members, kinds, range]);

  const events = liveEvents ?? shellEvents;

  const projectOptions = useMemo(
    () => persona.projects.map((p) => ({ id: p.id, label: p.name, hue: p.hue, hint: p.repo })),
    [persona.projects],
  );
  const memberOptions = useMemo(
    () =>
      persona.members
        .filter((m) => m.status !== "invited")
        .map((m) => ({ id: m.id, label: m.name, hue: m.hue, hint: m.role })),
    [persona.members],
  );

  const clearAll = () => {
    setProjects([]);
    setMembers([]);
    setKinds([]);
  };
  const anyActive = projects.length + members.length + kinds.length > 0;

  return (
    <>
      <Topbar breadcrumbs={["Timeline"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Activity
          </h1>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              color: "var(--fg-muted)",
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "oklch(0.7 0.15 145)",
                boxShadow: "0 0 0 3px oklch(0.7 0.15 145 / .25)",
              }}
            />
            Live
          </span>
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>
            Export
          </Btn>
          <Btn kind="secondary" icon={<I.panel />}>
            Group by project
          </Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {anyActive && (
            <>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  background: "transparent",
                  color: "var(--fg-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                <I.filter /> Clear filters
              </button>
              <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
            </>
          )}
          <FilterDropdown
            label="Project"
            options={projectOptions}
            selected={projects}
            onChange={setProjects}
            emptyText="No projects"
          />
          <FilterDropdown
            label="Member"
            options={memberOptions}
            selected={members}
            onChange={setMembers}
            emptyText="No members"
          />
          <FilterDropdown
            label="Type"
            options={TYPE_OPTIONS}
            selected={kinds}
            onChange={setKinds}
          />
          <FilterRangeChip
            label="Range"
            options={RANGE_OPTIONS}
            value={range}
            onChange={setRange}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
            {events.length} events{loading ? " · loading…" : " · updated just now"}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "6px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--accent-soft)",
          color: "var(--accent-soft-fg)",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
        3 new events since you opened this view <span style={{ flex: 1 }} />
        <button
          type="button"
          style={{
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontWeight: 500,
            fontSize: 12,
          }}
        >
          Show new ↑
        </button>
      </div>

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ height: "100%", overflowY: "auto" }}>
          {events.map((e, idx) => {
            const m = memberById(persona, e.member);
            const p =
              projectById(persona, e.project) ??
              ({ id: e.project, name: e.project, hue: 240 } as { id: string; name: string; hue: number });
            const isInsight = e.kind.startsWith("insight.");
            const tag = e.meta?.tag;
            const tm = tag ? TAG_MAP[tag] : null;

            if (!m) return null;

            const RowWrapper = ({ children }: { children: React.ReactNode }) =>
              e.session_id ? (
                <Link
                  href={`/team/sessions/${e.session_id}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 24px 1fr auto",
                    alignItems: "start",
                    gap: 12,
                    padding: "var(--row-pad-y) 24px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                    minHeight: "var(--row-h)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  {children}
                </Link>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 24px 1fr auto",
                    alignItems: "start",
                    gap: 12,
                    padding: "var(--row-pad-y) 24px",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                    minHeight: "var(--row-h)",
                  }}
                >
                  {children}
                </div>
              );

            return (
              <RowWrapper key={idx}>
                <div
                  style={{
                    color: "var(--fg-faint)",
                    fontSize: 11.5,
                    fontVariantNumeric: "tabular-nums",
                    paddingTop: 2,
                  }}
                >
                  {e.t} ago
                </div>
                <div style={{ paddingTop: 1 }}>
                  <Avatar m={m} size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m.name}</span>
                    {tm && (
                      <Badge kind={tm[0]} icon={tm[1]()}>
                        {tm[2]}
                      </Badge>
                    )}
                    {e.kind === "commit" && (
                      <Badge kind="neutral" icon={<I.commit />}>
                        Commit
                      </Badge>
                    )}
                    {e.kind === "session.started" && (
                      <Badge kind="info" icon={<I.session />}>
                        Session start
                      </Badge>
                    )}
                    {e.kind === "session.started" && (e.children_count ?? 0) > 0 && (
                      <Badge kind="info">
                        +{e.children_count} agent{e.children_count === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {e.kind === "session.ended" && (
                      <Badge kind="neutral" icon={<I.session />}>
                        Session end
                      </Badge>
                    )}
                    {e.kind === "project.created" && (
                      <Badge kind="warn" icon={<I.flag />}>
                        Needs review
                      </Badge>
                    )}
                    <span style={{ color: "var(--fg-faint)" }}>·</span>
                    <a
                      href="#"
                      style={{
                        color: "var(--fg-muted)",
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          background: `oklch(0.65 0.13 ${p.hue})`,
                        }}
                      />
                      {p.name}
                    </a>
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      color: isInsight ? "var(--fg-strong)" : "var(--fg)",
                      fontWeight: isInsight ? 450 : 400,
                      lineHeight: 1.45,
                    }}
                  >
                    {e.text}
                  </div>
                  {e.meta?.sha && (
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        fontSize: 11.5,
                        color: "var(--fg-muted)",
                      }}
                    >
                      <code
                        className="mono"
                        style={{
                          background: "var(--bg-muted)",
                          padding: "1px 5px",
                          borderRadius: 3,
                          fontSize: 11,
                        }}
                      >
                        {e.meta.sha}
                      </code>
                      <span>{e.meta.files} files</span>
                      <span style={{ color: "oklch(0.55 0.13 145)" }}>+{e.meta.plus}</span>
                      <span style={{ color: "oklch(0.55 0.16 28)" }}>−{e.meta.minus}</span>
                    </div>
                  )}
                </div>
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
              </RowWrapper>
            );
          })}
        </div>
      </div>
    </>
  );
}
