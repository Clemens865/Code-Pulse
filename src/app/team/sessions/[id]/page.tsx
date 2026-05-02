"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { I } from "../../_components/icons";
import { Avatar, Badge } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api, type ApiSessionDetail } from "../../_data/api";

const TOOL_HUE: Record<string, number> = {
  "tool.edit": 212,
  "tool.write": 212,
  "tool.read": 156,
  "tool.bash": 28,
  "tool.glob": 192,
  "tool.grep": 192,
  "tool.agent": 268,
  "tool.skill": 340,
  "tool.web_fetch": 86,
  "tool.web_search": 86,
  "tool.tool_search": 12,
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function shortKind(k: string): string {
  return k.replace(/^tool\./, "").replace(/^session\./, "");
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { openPalette, persona } = useShell();
  const [data, setData] = useState<ApiSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .session(id)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const memberFromPersona = (memberId: string) =>
    persona.members.find((m) => m.id === memberId);

  return (
    <>
      <Topbar
        breadcrumbs={[
          "Sessions",
          data?.session.project?.name ?? id.slice(0, 8),
          id.slice(0, 8),
        ]}
        onOpenPalette={openPalette}
      />
      {loading ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading session…</div>
      ) : error ? (
        <div style={{ padding: 24, color: "var(--status-err-fg)" }}>{error}</div>
      ) : !data ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>No data.</div>
      ) : (
        <SessionView data={data} memberFromPersona={memberFromPersona} />
      )}
    </>
  );
}

function SessionView({
  data,
  memberFromPersona,
}: {
  data: ApiSessionDetail;
  memberFromPersona: (id: string) => ReturnType<typeof useShell>["persona"]["members"][number] | undefined;
}) {
  const { session, stats, events } = data;
  const memberFromApi = session.member;
  const fauxAvatar = memberFromPersona(memberFromApi?.id ?? "")
    ?? (memberFromApi
      ? {
          id: memberFromApi.id,
          name: memberFromApi.name ?? memberFromApi.email,
          init: (memberFromApi.name ?? memberFromApi.email)
            .split(/[\s.@]/)
            .map((s) => s[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          hue: 212,
          role: "Engineer" as const,
          last: "—",
          projects: [] as string[],
          status: "active" as const,
        }
      : null);

  const kpis: Array<{ label: string; value: string | number; sub?: string; hue?: number }> = [
    { label: "Events", value: stats.events },
    { label: "Lines +", value: stats.lines_added, hue: 145 },
    { label: "Lines −", value: stats.lines_removed, hue: 28 },
    { label: "Net lines", value: (stats.net_lines >= 0 ? "+" : "") + stats.net_lines },
    { label: "Files", value: stats.files },
    { label: "Tools", value: stats.tools },
  ];

  return (
    <>
      {/* Header */}
      <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          {fauxAvatar && <Avatar m={fauxAvatar} size={36} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {session.member?.name ?? session.member?.email ?? "Session"} ·{" "}
                {session.project ? (
                  <Link
                    href={`/team/projects/${session.project.id}`}
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    {session.project.name}
                  </Link>
                ) : (
                  "—"
                )}
              </h1>
              <Badge kind="neutral">{formatDuration(session.duration_seconds)}</Badge>
              {stats.bash_failures > 0 && (
                <Badge kind="err">{stats.bash_failures} bash failures</Badge>
              )}
            </div>
            <div
              style={{
                marginTop: 4,
                color: "var(--fg-muted)",
                fontSize: 12.5,
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <span>started {new Date(session.started_at).toLocaleString()}</span>
              <span>·</span>
              <span>ended {new Date(session.ended_at).toLocaleString()}</span>
              {session.hook_version && (
                <>
                  <span>·</span>
                  <span>hook v{session.hook_version}</span>
                </>
              )}
              {session.cloud_env && session.cloud_env !== "local" && (
                <>
                  <span>·</span>
                  <span>{session.cloud_env}</span>
                </>
              )}
              {session.hostname && (
                <>
                  <span>·</span>
                  <code className="mono" style={{ fontSize: 11 }}>{session.hostname}</code>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div
        style={{
          padding: 24,
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {kpis.map((c) => (
          <div
            key={c.label}
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 12,
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
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: c.hue ? `oklch(0.6 0.16 ${c.hue})` : "var(--fg-strong)",
                marginTop: 4,
              }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Event timeline */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ padding: "12px 24px 8px" }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
            Event timeline · {events.length}
          </h3>
        </div>
        {events.map((e) => (
          <EventRow key={e.id} kind={e.kind} payload={e.payload} ts={e.hook_ts} />
        ))}
      </div>
    </>
  );
}

function EventRow({
  kind,
  payload,
  ts,
}: {
  kind: string;
  payload: Record<string, unknown>;
  ts: string;
}) {
  const hue = TOOL_HUE[kind] ?? 240;
  const label = kind.startsWith("tool.")
    ? shortKind(kind)
    : kind.startsWith("session.")
      ? `session ${shortKind(kind)}`
      : kind.startsWith("insight.")
        ? `insight ${shortKind(kind)}`
        : kind;
  const bashFailed =
    kind === "tool.bash" &&
    typeof payload["exit_code"] === "number" &&
    payload["exit_code"] !== 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 110px 1fr",
        alignItems: "start",
        gap: 12,
        padding: "8px 24px",
        borderBottom: "1px solid var(--border)",
        fontSize: 13,
      }}
    >
      <div
        style={{
          color: "var(--fg-faint)",
          fontSize: 11.5,
          fontVariantNumeric: "tabular-nums",
          paddingTop: 2,
        }}
      >
        {new Date(ts).toLocaleTimeString()}
      </div>
      <div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "1px 7px",
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 4,
            background: `oklch(0.95 0.04 ${hue})`,
            color: `oklch(0.35 0.16 ${hue})`,
            border: "1px solid transparent",
            whiteSpace: "nowrap",
          }}
        >
          {label}
          {bashFailed && (
            <span style={{ color: "oklch(0.55 0.16 28)", fontWeight: 600 }}>FAILED</span>
          )}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <PayloadRenderer kind={kind} payload={payload} />
      </div>
    </div>
  );
}

function PayloadRenderer({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  if (kind === "tool.edit" || kind === "tool.write") return <EditWriteRow kind={kind} payload={payload} />;
  if (kind === "tool.bash") return <BashRow payload={payload} />;
  if (kind === "tool.read") return <PathRow payload={payload} />;
  if (kind === "tool.glob" || kind === "tool.grep") return <PatternRow kind={kind} payload={payload} />;
  if (kind === "tool.agent") return <AgentRow payload={payload} />;
  if (kind === "tool.skill") return <SkillRow payload={payload} />;
  if (kind === "tool.web_fetch") return <WebFetchRow payload={payload} />;
  if (kind === "tool.web_search" || kind === "tool.tool_search")
    return <PatternRow kind={kind} payload={payload} />;
  if (kind.startsWith("session.")) return <SessionMarkerRow payload={payload} />;
  if (kind.startsWith("insight.")) return <InsightRow payload={payload} />;
  return <RawJson payload={payload} />;
}

function EditWriteRow({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const filePath = typeof payload["file_path"] === "string" ? (payload["file_path"] as string) : "";
  const oldStr = typeof payload["old_string"] === "string" ? (payload["old_string"] as string) : "";
  const newStr = typeof payload["new_string"] === "string" ? (payload["new_string"] as string) : "";
  const content = typeof payload["content"] === "string" ? (payload["content"] as string) : "";

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "transparent",
          border: "none",
          color: "var(--fg)",
          cursor: "pointer",
          padding: 0,
          fontFamily: "inherit",
          fontSize: 13,
        }}
      >
        <I.chevR
          style={{
            color: "var(--fg-faint)",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform var(--dur-fast) var(--ease-std)",
          }}
        />
        <code className="mono" style={{ fontSize: 12 }}>
          {filePath || "(no path)"}
        </code>
      </button>
      {open && (oldStr || newStr || content) && (
        <pre
          className="mono"
          style={{
            marginTop: 6,
            background: "var(--bg-muted)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 10,
            fontSize: 11.5,
            overflow: "auto",
            maxHeight: 320,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {kind === "tool.write" ? (
            <span style={{ color: "oklch(0.55 0.13 145)" }}>+ {content}</span>
          ) : (
            <>
              {oldStr && (
                <span style={{ color: "oklch(0.55 0.16 28)" }}>
                  {`- ${oldStr.split("\n").join("\n- ")}\n`}
                </span>
              )}
              {newStr && (
                <span style={{ color: "oklch(0.55 0.13 145)" }}>
                  {`+ ${newStr.split("\n").join("\n+ ")}`}
                </span>
              )}
            </>
          )}
        </pre>
      )}
    </div>
  );
}

function BashRow({ payload }: { payload: Record<string, unknown> }) {
  const cmd = typeof payload["command"] === "string" ? (payload["command"] as string) : "";
  return (
    <code className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
      <span style={{ color: "var(--fg-faint)" }}>$ </span>
      {cmd || "(no command)"}
    </code>
  );
}

function PathRow({ payload }: { payload: Record<string, unknown> }) {
  const f = typeof payload["file_path"] === "string" ? (payload["file_path"] as string) : "";
  return (
    <code className="mono" style={{ fontSize: 12 }}>
      {f || "(no path)"}
    </code>
  );
}

function PatternRow({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const p = (typeof payload["pattern"] === "string" ? payload["pattern"] : payload["query"]) as string | undefined;
  return (
    <span style={{ color: "var(--fg-muted)", fontSize: 12.5 }}>
      <code className="mono" style={{ fontSize: 12 }}>{p ?? "(no pattern)"}</code>
      {typeof payload["path"] === "string" && (
        <span style={{ marginLeft: 8, color: "var(--fg-faint)" }}>in {String(payload["path"])}</span>
      )}
    </span>
  );
}

function AgentRow({ payload }: { payload: Record<string, unknown> }) {
  const type =
    typeof payload["subagent_type"] === "string"
      ? (payload["subagent_type"] as string)
      : typeof payload["type"] === "string"
        ? (payload["type"] as string)
        : "";
  const desc =
    typeof payload["description"] === "string"
      ? (payload["description"] as string)
      : typeof payload["prompt"] === "string"
        ? (payload["prompt"] as string).slice(0, 200)
        : "";
  return (
    <div>
      {type && (
        <Badge kind="info">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{type}</span>
        </Badge>
      )}
      {desc && (
        <span style={{ marginLeft: 8, fontSize: 12.5, color: "var(--fg-muted)" }}>{desc}</span>
      )}
    </div>
  );
}

function SkillRow({ payload }: { payload: Record<string, unknown> }) {
  const name =
    typeof payload["skill"] === "string"
      ? (payload["skill"] as string)
      : typeof payload["name"] === "string"
        ? (payload["name"] as string)
        : "?";
  const args = typeof payload["args"] === "string" ? (payload["args"] as string) : "";
  return (
    <div style={{ fontSize: 12.5 }}>
      <code className="mono" style={{ fontSize: 12 }}>/{name}</code>
      {args && <span style={{ marginLeft: 8, color: "var(--fg-muted)" }}>{args}</span>}
    </div>
  );
}

function WebFetchRow({ payload }: { payload: Record<string, unknown> }) {
  const url = typeof payload["url"] === "string" ? payload["url"] : "";
  return (
    <code className="mono" style={{ fontSize: 12 }}>
      {url || "(no url)"}
    </code>
  );
}

function SessionMarkerRow({ payload }: { payload: Record<string, unknown> }) {
  const text = typeof payload["text"] === "string" ? payload["text"] : "";
  return (
    <span style={{ color: "var(--fg-muted)", fontStyle: "italic", fontSize: 12.5 }}>
      {text || "(session marker)"}
    </span>
  );
}

function InsightRow({ payload }: { payload: Record<string, unknown> }) {
  const text = typeof payload["text"] === "string" ? payload["text"] : "";
  const reasoning = typeof payload["reasoning"] === "string" ? payload["reasoning"] : "";
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ color: "var(--fg-strong)", fontWeight: 500 }}>{text || "(no content)"}</div>
      {reasoning && (
        <div style={{ marginTop: 2, color: "var(--fg-muted)", fontStyle: "italic" }}>{reasoning}</div>
      )}
    </div>
  );
}

function RawJson({ payload }: { payload: Record<string, unknown> }) {
  const s = JSON.stringify(payload);
  return (
    <code
      className="mono"
      style={{
        fontSize: 11,
        color: "var(--fg-faint)",
        background: "var(--bg-muted)",
        padding: "1px 6px",
        borderRadius: 3,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        display: "inline-block",
        maxWidth: 600,
      }}
    >
      {s.length > 500 ? s.slice(0, 500) + "…" : s}
    </code>
  );
}
