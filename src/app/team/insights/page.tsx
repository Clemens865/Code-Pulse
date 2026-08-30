"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { I } from "../_components/icons";
import { Avatar, Badge, Btn, Kbd } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { FilterDropdown } from "../_components/filter-dropdown";
import { adaptApiInsights, api } from "../_data/api";
import { memberById, projectById, type Insight, type InsightTag } from "../_data/sample";

type ExtType = "decision" | "blocker" | "progress" | "pattern" | "fix" | "context";

const TAG_MAP: Record<ExtType, ["accent" | "err" | "ok" | "neutral" | "info", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
  pattern: ["info", () => <I.insights />, "Pattern"],
  fix: ["neutral", () => <I.insights />, "Fix"],
  context: ["neutral", () => <I.insights />, "Context"],
};

const TYPE_OPTIONS: Array<{ id: ExtType; label: string }> = [
  { id: "decision", label: "Decision" },
  { id: "blocker", label: "Blocker" },
  { id: "progress", label: "Progress" },
  { id: "pattern", label: "Pattern" },
  { id: "fix", label: "Fix" },
  { id: "context", label: "Context" },
];

export default function InsightsPage() {
  const { openPalette, persona, insights: shellInsights, source } = useShell();

  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);

  const [liveInsights, setLiveInsights] = useState<Insight[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Refetch from server when filters change (live mode). For sample mode,
  // we filter shellInsights in-memory below.
  useEffect(() => {
    if (source !== "live") {
      setLiveInsights(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .insights({
        q: query || undefined,
        projects: projects.length > 0 ? projects : undefined,
        types: types.length > 0 ? types : undefined,
      })
      .then((r) => {
        if (!cancelled) setLiveInsights(adaptApiInsights(r.insights));
      })
      .catch(() => {
        if (!cancelled) setLiveInsights(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, query, projects, types]);

  // Member filter applies client-side (api.insights doesn't expose it yet).
  const allInsights = useMemo(() => {
    const base = liveInsights ?? shellInsights;
    if (members.length === 0) return base;
    return base.filter((i) => members.includes(i.member));
  }, [liveInsights, shellInsights, members]);

  // For sample mode, also apply query / types / projects in-memory.
  const filteredInsights = useMemo(() => {
    if (source === "live") return allInsights;
    let xs = allInsights;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      xs = xs.filter((i) => (i.title + " " + i.text).toLowerCase().includes(q));
    }
    if (types.length > 0) xs = xs.filter((i) => types.includes(i.type));
    if (projects.length > 0) xs = xs.filter((i) => projects.includes(i.project));
    return xs;
  }, [allInsights, source, query, types, projects]);

  const projectOptions = useMemo(
    () => persona.projects.map((p) => ({ id: p.id, label: p.name, hue: p.hue })),
    [persona.projects],
  );
  const memberOptions = useMemo(
    () =>
      persona.members
        .filter((m) => m.status !== "invited")
        .map((m) => ({ id: m.id, label: m.name, hue: m.hue })),
    [persona.members],
  );

  return (
    <>
      <Topbar breadcrumbs={["Insights"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Insights
          </h1>
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>
            Export
          </Btn>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--bg)",
            boxShadow: "0 0 0 3px var(--accent-soft)",
          }}
        >
          <I.search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decisions, blockers, progress…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--fg-strong)",
              fontFamily: "inherit",
              fontSize: 13.5,
            }}
          />
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
            {filteredInsights.length} result{filteredInsights.length === 1 ? "" : "s"}
            {loading ? " · loading…" : ""}
          </span>
          <Kbd>esc</Kbd>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <FilterDropdown
            label="Type"
            options={TYPE_OPTIONS}
            selected={types}
            onChange={setTypes}
          />
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <FilterDropdown
            label="Project"
            options={projectOptions}
            selected={projects}
            onChange={setProjects}
          />
          <FilterDropdown
            label="Member"
            options={memberOptions}
            selected={members}
            onChange={setMembers}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {filteredInsights.length === 0 && !loading && (
          <div style={{ padding: "32px 24px", color: "var(--fg-faint)", textAlign: "center", fontSize: 13 }}>
            No insights match the current filters.
          </div>
        )}
        {filteredInsights.map((it, idx) => {
          const m = memberById(persona, it.member);
          const p = projectById(persona, it.project);
          if (!m || !p) return null;
          const tm = TAG_MAP[it.type as ExtType] ?? TAG_MAP.context;
          const q = query.trim();
          const parts = q ? it.title.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i")) : [it.title];
          return (
            <div
              key={idx}
              style={{
                padding: "12px 24px",
                borderBottom: "1px solid var(--border)",
                display: "grid",
                gridTemplateColumns: "120px 1fr auto",
                gap: 14,
                alignItems: "start",
              }}
            >
              <Badge kind={tm[0]} icon={tm[1]()}>
                {tm[2]}
              </Badge>
              <div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: "var(--fg-strong)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {q
                    ? parts.map((part, i) =>
                        i % 2 === 1 ? (
                          <mark
                            key={i}
                            style={{
                              background: "var(--accent-soft)",
                              color: "var(--accent-soft-fg)",
                              padding: "0 2px",
                              borderRadius: 2,
                            }}
                          >
                            {part}
                          </mark>
                        ) : (
                          <Fragment key={i}>{part}</Fragment>
                        ),
                      )
                    : it.title}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 3, lineHeight: 1.5 }}>
                  {it.text}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 11.5,
                    color: "var(--fg-faint)",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        background: `oklch(0.65 0.13 ${p.hue})`,
                      }}
                    />
                    {p.name}
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <Avatar m={m} size={16} /> {m.name}
                  </span>
                  <span>{it.t} ago</span>
                </div>
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
            </div>
          );
        })}
      </div>
    </>
  );
}
