"use client";

import { useEffect, useState } from "react";
import { Badge, Btn, cell } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api } from "../../_data/api";

type KeyRow = {
  id: string;
  memberId: string;
  label: string | null;
  last4: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  status: "active" | "revoked";
};

type Toast = { kind: "ok" | "err"; text: string } | null;

export default function AdminKeysPage() {
  const { openPalette, persona } = useShell();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.listKeys();
      setKeys(r.keys);
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Failed to load" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const onRevoke = async (k: KeyRow) => {
    if (!confirm(`Revoke key ending …${k.last4}? Workstations using it will start getting 401s.`)) return;
    try {
      await api.revokeKey(k.id);
      setToast({ kind: "ok", text: "Key revoked" });
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Revoke failed" });
    }
  };

  const memberName = (id: string) => persona.members.find((m) => m.id === id)?.name ?? "—";

  return (
    <>
      <Topbar breadcrumbs={["Admin", "API keys"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            API keys
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
            {keys.filter((k) => k.status === "active").length} active · {keys.length} total
          </span>
          <span style={{ flex: 1 }} />
        </div>
      </div>

      {toast && (
        <div
          style={{
            padding: "8px 24px",
            background: toast.kind === "ok" ? "var(--status-ok-bg)" : "var(--status-err-bg)",
            color: toast.kind === "ok" ? "var(--status-ok-fg)" : "var(--status-err-fg)",
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            display: "flex",
          }}
        >
          {toast.text}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setToast(null)}
            type="button"
            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading…</div>
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
                {["Label", "Member", "Last 4", "Status", "Last used", "Created", "Actions"].map(
                  (h, i) => (
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={cell({})}>{k.label ?? <span style={{ color: "var(--fg-faint)" }}>—</span>}</td>
                  <td style={cell({})}>{memberName(k.memberId)}</td>
                  <td style={cell({})}>
                    <code className="mono" style={{ fontSize: 11.5 }}>cpt_••••{k.last4}</code>
                  </td>
                  <td style={cell({})}>
                    <Badge kind={k.status === "active" ? "ok" : "stale"}>{k.status}</Badge>
                  </td>
                  <td style={cell({})}>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}
                    </span>
                  </td>
                  <td style={cell({})}>
                    <span style={{ color: "var(--fg-muted)" }}>
                      {new Date(k.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td style={cell({})}>
                    {k.status === "active" ? (
                      <Btn kind="ghost" onClick={() => onRevoke(k)}>
                        Revoke
                      </Btn>
                    ) : (
                      <span style={{ color: "var(--fg-faint)", fontSize: 11.5 }}>
                        revoked {k.revokedAt && new Date(k.revokedAt).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
                    No API keys yet. Issue one from the Members page.
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
