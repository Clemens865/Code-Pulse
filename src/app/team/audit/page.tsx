"use client";

// Compliance audit timeline. Per CAPTURE-LAYER.md §9 Sprint 4 +
// COMPLIANCE.md — this is the procurement-wedge surface: "show me
// everything that touched this file" and "what commands failed."
// Top-nav, dashboard-auth.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { I } from "../_components/icons";
import { Avatar, Badge, Btn } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { api } from "../_data/api";
import { memberById } from "../_data/sample";

type Tab = "file" | "failures";

type FileEvent = {
  id: string;
  ts: string;
  tool_name: string;
  member: { id: string; name: string | null };
  project: { id: string; name: string };
  session_id: string;
  lines_added: number;
  lines_removed: number;
  command: string | null;
  command_failed: boolean;
};

type FailureEvent = {
  id: string;
  ts: string;
  member: { id: string; name: string | null };
  project: { id: string; name: string };
  session_id: string;
  command: string | null;
};

export default function AuditPage() {
  const { openPalette, persona, source } = useShell();
  const [tab, setTab] = useState<Tab>("file");

  return (
    <>
      <Topbar breadcrumbs={["Audit"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Audit
          </h1>
          <span style={{ fontSize: 12, color: "var(--fg-faint)" }}>
            Compliance & incident response
          </span>
        </div>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid transparent" }}>
          {(["file", "failures"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  padding: "10px 14px",
                  fontSize: 13,
                  fontFamily: "inherit",
                  background: "transparent",
                  border: "none",
                  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                  color: active ? "var(--fg-strong)" : "var(--fg-muted)",
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                }}
              >
                {t === "file" ? "File timeline" : "Command failures"}
              </button>
            );
          })}
        </div>
      </div>

      {tab === "file" ? <FileTab persona={persona} /> : <FailuresTab persona={persona} liveOnly={source === "live"} />}
    </>
  );
}

// ──────────────────── File tab ────────────────────

function FileTab({ persona }: { persona: ReturnType<typeof useShell>["persona"] }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ file_path: string; edits: number; last_ts: string }>>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [events, setEvents] = useState<FileEvent[]>([]);
  const [loadingPath, setLoadingPath] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      api
        .auditFiles(query.trim(), 12)
        .then((r) => setSuggestions(r.files))
        .catch(() => setSuggestions([]));
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Load events when a path is selected
  useEffect(() => {
    if (!selectedPath) return;
    let cancelled = false;
    setLoadingPath(true);
    api
      .auditFile(selectedPath, 500)
      .then((r) => {
        if (!cancelled) setEvents(r.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPath(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "20px 24px", maxWidth: 1100 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--fg-muted)", display: "block", marginBottom: 6 }}>
            Search a file path — see every event that touched it
          </label>
          <div style={{ position: "relative" }}>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedPath(null);
              }}
              placeholder="src/checkout/stripe.ts"
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg)",
                color: "var(--fg-strong)",
                outline: "none",
              }}
            />
            {suggestions.length > 0 && !selectedPath && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  maxHeight: 360,
                  overflowY: "auto",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  boxShadow: "var(--shadow-modal)",
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s.file_path}
                    type="button"
                    onClick={() => {
                      setSelectedPath(s.file_path);
                      setQuery(s.file_path);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 12px",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      fontSize: 12.5,
                    }}
                  >
                    <code className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fg-strong)" }}>
                      {s.file_path}
                    </code>
                    <span style={{ fontSize: 11, color: "var(--fg-faint)", flexShrink: 0 }}>
                      {s.edits} edit{s.edits === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedPath && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                {events.length} event{events.length === 1 ? "" : "s"}
                {loadingPath ? " · loading…" : ""}
              </h2>
              <span style={{ flex: 1 }} />
              <a
                href={api.auditFileCsvUrl(selectedPath)}
                style={{ textDecoration: "none" }}
              >
                <Btn kind="secondary" icon={<I.download />}>
                  Download CSV
                </Btn>
              </a>
            </div>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 80px 24px 1fr 100px 90px",
                  gap: 12,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-muted)",
                  fontSize: 11,
                  color: "var(--fg-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                <div>When</div>
                <div>Tool</div>
                <div></div>
                <div>Who · Project</div>
                <div style={{ textAlign: "right" }}>Lines</div>
                <div style={{ textAlign: "right" }}>Session</div>
              </div>
              {events.map((e) => {
                const m = memberById(persona, e.member.id) ?? {
                  id: e.member.id,
                  name: e.member.name ?? "Unknown",
                  init: (e.member.name ?? "?").charAt(0).toUpperCase(),
                  hue: 212,
                  role: "Engineer" as const,
                  last: "—",
                  projects: [],
                  status: "active" as const,
                };
                return (
                  <div
                    key={e.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "180px 80px 24px 1fr 100px 90px",
                      gap: 12,
                      padding: "8px 14px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12.5,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                      {formatTs(e.ts)}
                    </div>
                    <div>
                      <Badge kind={e.command_failed ? "err" : "neutral"}>{e.tool_name}</Badge>
                    </div>
                    <Avatar m={m} size={20} />
                    <div style={{ minWidth: 0 }}>
                      <span style={{ color: "var(--fg-strong)" }}>{e.member.name ?? "—"}</span>
                      <span style={{ color: "var(--fg-faint)" }}>{" · "}</span>
                      <span style={{ color: "var(--fg-muted)" }}>{e.project.name}</span>
                    </div>
                    <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                      {e.lines_added > 0 || e.lines_removed > 0 ? (
                        <>
                          <span style={{ color: "oklch(0.55 0.13 145)" }}>+{e.lines_added}</span>
                          <span style={{ color: "var(--fg-faint)" }}> / </span>
                          <span style={{ color: "oklch(0.55 0.16 28)" }}>−{e.lines_removed}</span>
                        </>
                      ) : (
                        <span style={{ color: "var(--fg-faint)" }}>—</span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Link
                        href={`/team/sessions/${e.session_id}`}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 11,
                          color: "var(--accent)",
                          textDecoration: "none",
                        }}
                      >
                        {e.session_id.slice(0, 8)}
                      </Link>
                    </div>
                  </div>
                );
              })}
              {events.length === 0 && !loadingPath && (
                <div style={{ padding: "20px", textAlign: "center", color: "var(--fg-faint)", fontSize: 13 }}>
                  No events recorded for this file.
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedPath && (
          <div
            style={{
              padding: "32px",
              textAlign: "center",
              color: "var(--fg-faint)",
              fontSize: 13,
              border: "1px dashed var(--border)",
              borderRadius: 8,
              marginTop: 8,
            }}
          >
            Type at least one character above. Pick a file from the list to see its full audit trail.
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────── Failures tab ────────────────────

function FailuresTab({
  persona,
  liveOnly,
}: {
  persona: ReturnType<typeof useShell>["persona"];
  liveOnly: boolean;
}) {
  const [events, setEvents] = useState<FailureEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .auditFailures(200)
      .then((r) => {
        if (!cancelled) setEvents(r.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const list = events ?? [];

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "20px 24px", maxWidth: 1100 }}>
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: 0 }}>
            Bash commands that exited non-zero. Useful for incident reconstruction.
          </p>
          <span style={{ flex: 1 }} />
          {!liveOnly && (
            <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
              (sample data shows none — live mode populates from real events)
            </span>
          )}
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px 24px 200px 1fr 90px",
              gap: 12,
              padding: "8px 14px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-muted)",
              fontSize: 11,
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            <div>When</div>
            <div></div>
            <div>Member · Project</div>
            <div>Command</div>
            <div style={{ textAlign: "right" }}>Session</div>
          </div>
          {list.map((e) => {
            const m = memberById(persona, e.member.id) ?? {
              id: e.member.id,
              name: e.member.name ?? "Unknown",
              init: (e.member.name ?? "?").charAt(0).toUpperCase(),
              hue: 28,
              role: "Engineer" as const,
              last: "—",
              projects: [],
              status: "active" as const,
            };
            return (
              <div
                key={e.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 24px 200px 1fr 90px",
                  gap: 12,
                  padding: "8px 14px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 12.5,
                  alignItems: "center",
                }}
              >
                <div style={{ color: "var(--fg-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {formatTs(e.ts)}
                </div>
                <Avatar m={m} size={20} />
                <div style={{ minWidth: 0, fontSize: 12 }}>
                  <span style={{ color: "var(--fg-strong)" }}>{e.member.name ?? "—"}</span>
                  <span style={{ color: "var(--fg-faint)" }}>{" · "}</span>
                  <span style={{ color: "var(--fg-muted)" }}>{e.project.name}</span>
                </div>
                <code
                  className="mono"
                  style={{
                    fontSize: 11.5,
                    color: "var(--fg)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {e.command ?? "—"}
                </code>
                <div style={{ textAlign: "right" }}>
                  <Link
                    href={`/team/sessions/${e.session_id}`}
                    style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", textDecoration: "none" }}
                  >
                    {e.session_id.slice(0, 8)}
                  </Link>
                </div>
              </div>
            );
          })}
          {list.length === 0 && (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--fg-faint)", fontSize: 13 }}>
              {loading ? "Loading…" : "No command failures recorded."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────── helpers ────────────────────

function formatTs(iso: string): string {
  // "2026-04-23 19:57:09+00" → "Apr 23, 19:57"
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return iso;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
}
