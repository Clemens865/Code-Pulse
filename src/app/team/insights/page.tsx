"use client";

import { Fragment } from "react";
import { I } from "../_components/icons";
import { Avatar, Badge, Btn, Chip, Kbd } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { memberById, projectById, type InsightTag } from "../_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
};

const QUERY = "rounding rule";

export default function InsightsPage() {
  const { openPalette, persona, insights: allInsights } = useShell();

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
            defaultValue={QUERY}
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
            {allInsights.length} results
          </span>
          <Kbd>esc</Kbd>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Chip hasValue>
            <span style={{ color: "var(--accent)" }}>
              <I.decision />
            </span>{" "}
            Decisions · 3
          </Chip>
          <Chip hasValue>
            <span style={{ color: "oklch(0.55 0.16 28)" }}>
              <I.blocker />
            </span>{" "}
            Blockers · 3
          </Chip>
          <Chip>
            <span style={{ color: "oklch(0.55 0.13 145)" }}>
              <I.progress />
            </span>{" "}
            Progress
          </Chip>
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <Chip>
            Project <I.chevron />
          </Chip>
          <Chip>
            Member <I.chevron />
          </Chip>
          <Chip>
            Date range <I.chevron />
          </Chip>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {allInsights.map((it, idx) => {
          const m = memberById(persona, it.member);
          const p = projectById(persona, it.project);
          if (!m || !p) return null;
          const tm = TAG_MAP[it.type];
          const parts = it.title.split(QUERY);
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
                  {parts.map((part, i) => (
                    <Fragment key={i}>
                      {part}
                      {i < parts.length - 1 && (
                        <mark
                          style={{
                            background: "var(--accent-soft)",
                            color: "var(--accent-soft-fg)",
                            padding: "0 2px",
                            borderRadius: 2,
                          }}
                        >
                          {QUERY}
                        </mark>
                      )}
                    </Fragment>
                  ))}
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
