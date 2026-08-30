"use client";

import { useEffect, useState } from "react";
import { Badge, cell } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api } from "../../_data/api";

type Entry = {
  id: number;
  eventId: string | null;
  reason: string;
  lastError: string | null;
  retryCount: number;
  receivedAt: string;
  resolvedAt: string | null;
  payload: Record<string, unknown>;
};

export default function AdminDeadLetterPage() {
  const { openPalette } = useShell();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .deadLetter({ includeResolved, limit: 200 })
      .then((r) => {
        if (cancelled) return;
        setEntries(r.events);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [includeResolved]);

  const open = entries.filter((e) => !e.resolvedAt).length;

  return (
    <>
      <Topbar breadcrumbs={["Admin", "Dead-letter"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Dead-letter events
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
            {open} open{includeResolved && entries.length > open ? ` · ${entries.length - open} resolved` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-muted)" }}>
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />
            Include resolved
          </label>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--fg-faint)", maxWidth: 720 }}>
          Events accepted into <code className="mono">event_log</code> but failed to project into the
          typed tables (sessions / tool_events / insights / file_activity). The source-of-truth row
          is intact; a backfill can rebuild the derived row from <code className="mono">event_log</code>.
        </p>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: 24, color: "var(--status-err-fg)" }}>{error}</div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
                {["When", "Reason", "Event ID", "Error", "Retries", "Status"].map((h, i) => (
                  <th
                    key={i}
                    style={{
                      textAlign: "left",
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
              {entries.map((e) => (
                <tr key={e.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={cell({})}>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {new Date(e.receivedAt).toLocaleString()}
                    </span>
                  </td>
                  <td style={cell({})}>
                    <Badge kind={e.reason.startsWith("derive_failed") ? "err" : "warn"}>{e.reason}</Badge>
                  </td>
                  <td style={cell({})}>
                    {e.eventId ? (
                      <code className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                        {e.eventId.slice(0, 8)}
                      </code>
                    ) : (
                      <span style={{ color: "var(--fg-faint)" }}>—</span>
                    )}
                  </td>
                  <td style={cell({})}>
                    <code
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--status-err-fg)",
                        background: "var(--status-err-bg)",
                        padding: "1px 5px",
                        borderRadius: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "inline-block",
                        maxWidth: 540,
                      }}
                      title={e.lastError ?? ""}
                    >
                      {e.lastError ?? "—"}
                    </code>
                  </td>
                  <td style={cell({})}>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--fg-muted)" }}>
                      {e.retryCount}
                    </span>
                  </td>
                  <td style={cell({})}>
                    {e.resolvedAt ? (
                      <Badge kind="ok">resolved</Badge>
                    ) : (
                      <Badge kind="warn">open</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
                    {includeResolved ? "No dead-letter events." : "No open dead-letter events."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
