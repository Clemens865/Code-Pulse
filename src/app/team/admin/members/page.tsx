"use client";

import { useEffect, useState } from "react";
import { I } from "../../_components/icons";
import { Avatar, Badge, Btn, cell } from "../../_components/primitives";
import { Topbar } from "../../_components/topbar";
import { useShell } from "../../_components/shell";
import { api, type ApiMember, type ApiRole } from "../../_data/api";

type Toast = { kind: "ok" | "err"; text: string } | null;

export default function AdminMembersPage() {
  const { openPalette } = useShell();
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<Toast>(null);
  const [keyReveal, setKeyReveal] = useState<{ memberName: string; plaintext: string } | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.members();
      setMembers(r.members);
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Failed to load" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const onInvite = async (email: string, name: string, role: ApiRole) => {
    try {
      const r = await api.inviteMember(email, name || undefined, role);
      setToast({
        kind: "ok",
        text: r.deduped ? "Already invited (deduped)" : "Invitation sent",
      });
      setShowInvite(false);
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Invite failed" });
    }
  };

  const onChangeRole = async (id: string, role: ApiRole) => {
    try {
      await api.updateMember(id, { role });
      setToast({ kind: "ok", text: "Role updated" });
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Update failed" });
    }
  };

  const onSetStatus = async (id: string, status: "active" | "deactivated") => {
    try {
      await api.updateMember(id, { status });
      setToast({ kind: "ok", text: status === "active" ? "Activated" : "Deactivated" });
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Update failed" });
    }
  };

  const onIssueKey = async (m: ApiMember) => {
    try {
      const r = await api.issueKey(m.id, `${m.name}-${new Date().toISOString().slice(0, 10)}`);
      setKeyReveal({ memberName: m.name, plaintext: r.plaintext });
      await reload();
    } catch (e) {
      setToast({ kind: "err", text: e instanceof Error ? e.message : "Key issue failed" });
    }
  };

  return (
    <>
      <Topbar breadcrumbs={["Admin", "Members & roles"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Members & roles
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>{members.length} total</span>
          <span style={{ flex: 1 }} />
          <Btn kind="primary" icon={<I.plus />} onClick={() => setShowInvite(true)}>
            Invite member
          </Btn>
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
            alignItems: "center",
            gap: 8,
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
                {["Member", "Role", "Status", "Last seen", "API key", "Actions"].map((h, i) => (
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
              {members.map((m) => {
                const fauxAvatar = {
                  id: m.id,
                  name: m.name,
                  init: (m.name || m.email).split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase(),
                  hue: ((m.id.charCodeAt(0) || 0) * 13) % 360,
                  role: "Engineer" as const,
                  last: "—",
                  projects: [] as string[],
                  status: "active" as const,
                };
                return (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={cell({})}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar m={fauxAvatar} size={24} />
                        <div>
                          <div style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m.name}</div>
                          <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>{m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={cell({})}>
                      <RoleSelect role={m.role as ApiRole} onChange={(r) => onChangeRole(m.id, r)} />
                    </td>
                    <td style={cell({})}>
                      <Badge
                        kind={
                          m.status === "active"
                            ? "ok"
                            : m.status === "invited"
                              ? "warn"
                              : "stale"
                        }
                      >
                        {m.status}
                      </Badge>
                    </td>
                    <td style={cell({})}>
                      <span style={{ color: "var(--fg-muted)" }}>
                        {m.last_seen ? new Date(m.last_seen).toLocaleString() : "—"}
                      </span>
                    </td>
                    <td style={cell({})}>
                      <Badge kind={m.key_status === "active" ? "ok" : "neutral"}>
                        {m.key_status === "active" ? "Active" : "None"}
                      </Badge>
                    </td>
                    <td style={cell({})}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Btn kind="soft" onClick={() => onIssueKey(m)}>
                          Issue key
                        </Btn>
                        {m.status === "active" ? (
                          <Btn kind="ghost" onClick={() => onSetStatus(m.id, "deactivated")}>
                            Deactivate
                          </Btn>
                        ) : (
                          <Btn kind="ghost" onClick={() => onSetStatus(m.id, "active")}>
                            Activate
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onSubmit={onInvite} />}
      {keyReveal && <KeyRevealModal data={keyReveal} onClose={() => setKeyReveal(null)} />}
    </>
  );
}

function RoleSelect({ role, onChange }: { role: ApiRole; onChange: (r: ApiRole) => void }) {
  return (
    <select
      value={role}
      onChange={(e) => onChange(e.currentTarget.value as ApiRole)}
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 12,
        fontFamily: "inherit",
        color: "var(--fg)",
        cursor: "pointer",
      }}
    >
      <option value="owner">Owner</option>
      <option value="admin">Admin</option>
      <option value="lead">Lead</option>
      <option value="member">Member</option>
    </select>
  );
}

function InviteModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (email: string, name: string, role: ApiRole) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ApiRole>("member");
  return (
    <ModalShell onClose={onClose} title="Invite member">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email) return;
          onSubmit(email, name, role);
        }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Field label="Email">
          <input
            autoFocus
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Name (optional)">
          <input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Role">
          <RoleSelect role={role} onChange={setRole} />
        </Field>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
          <Btn kind="ghost" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="primary" type="submit">
            Send invitation
          </Btn>
        </div>
      </form>
    </ModalShell>
  );
}

function KeyRevealModal({
  data,
  onClose,
}: {
  data: { memberName: string; plaintext: string };
  onClose: () => void;
}) {
  return (
    <ModalShell onClose={onClose} title="Save this API key now">
      <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 0 }}>
        We won’t show {data.memberName}’s key again. Copy it into a password manager
        or workstation config now.
      </p>
      <pre
        style={{
          background: "var(--bg-muted)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          overflowX: "auto",
          margin: 0,
        }}
      >
        {data.plaintext}
      </pre>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <Btn kind="primary" onClick={onClose}>
          I’ve saved it
        </Btn>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      style={{ position: "fixed", inset: 0, background: "oklch(0.15 0.01 240 / 0.40)", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: "12vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: 520,
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          padding: 18,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h2>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--fg-muted)" }}>
      <span style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 10px",
  fontFamily: "inherit",
  fontSize: 13,
  color: "var(--fg)",
};
