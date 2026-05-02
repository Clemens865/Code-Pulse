"use client";

import { useEffect, useState } from "react";
import { Badge, cell } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api } from "../../_data/api";

type Entry = {
  id: number;
  ts: string;
  actor_member_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload: Record<string, unknown>;
};

const ACTION_KIND: Record<string, "accent" | "ok" | "err" | "warn" | "neutral"> = {
  "member.invite": "accent",
  "member.update": "info" as never,
  "api_key.issue": "ok",
  "api_key.revoke": "warn",
  "project.confirm": "ok",
  "project.update": "neutral",
};

export default function AdminAuditPage() {
  const { openPalette, persona } = useShell();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .auditLog()
      .then((r) => {
        if (cancelled) return;
        setEntries(r.entries);
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
  }, []);

  const memberName = (id: string | null) =>
    id ? persona.members.find((m) => m.id === id)?.name ?? id.slice(0, 8) : "system";

  return (
    <>
      <Topbar breadcrumbs={["Admin", "Audit log"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Audit log
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
            {entries.length} most recent
          </span>
          <span style={{ flex: 1 }} />
        </div>
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
                {["When", "Actor", "Action", "Target", "Details"].map((h, i) => (
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
                      {new Date(e.ts).toLocaleString()}
                    </span>
                  </td>
                  <td style={cell({})}>{memberName(e.actor_member_id)}</td>
                  <td style={cell({})}>
                    <Badge kind={ACTION_KIND[e.action] ?? "neutral"}>{e.action}</Badge>
                  </td>
                  <td style={cell({})}>
                    <span style={{ color: "var(--fg-muted)", fontSize: 11.5 }}>
                      {e.target_type ?? "—"}
                      {e.target_id && (
                        <code className="mono" style={{ fontSize: 11, marginLeft: 6 }}>
                          {e.target_id.slice(0, 8)}
                        </code>
                      )}
                    </span>
                  </td>
                  <td style={cell({})}>
                    <code
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: "var(--fg-muted)",
                        background: "var(--bg-muted)",
                        padding: "1px 5px",
                        borderRadius: 3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "inline-block",
                        maxWidth: 460,
                      }}
                    >
                      {JSON.stringify(e.payload)}
                    </code>
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
                    No admin actions yet.
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
