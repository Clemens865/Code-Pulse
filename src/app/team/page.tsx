"use client";

import Link from "next/link";
import { I } from "./_components/icons";
import { Avatar, Badge, Btn, Chip } from "./_components/primitives";
import { Topbar } from "./_components/topbar";
import { useShell } from "./_components/shell";
import { memberById, projectById, type InsightTag } from "./_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
};

export default function TimelinePage() {
  const { openPalette, persona, timeline: events } = useShell();

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
          <Chip>
            <I.filter /> Filters
          </Chip>
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <Chip hasValue>
            Project · 3 <I.chevron />
          </Chip>
          <Chip>
            Member <I.chevron />
          </Chip>
          <Chip>
            Type <I.chevron />
          </Chip>
          <Chip hasValue>
            Last 24h <I.chevron />
          </Chip>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
            {events.length} events · updated just now
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
