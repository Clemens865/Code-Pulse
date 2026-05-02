"use client";

import { use, useEffect, useState } from "react";
import { Avatar, Badge, cell } from "../../../_components/primitives";
import { api } from "../../../_data/api";

type ProjMember = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
};

export default function ProjectMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [members, setMembers] = useState<ProjMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.project(id)
      .then((r) => {
        if (!cancelled) setMembers((r as unknown as { members?: ProjMember[] }).members ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      {loading ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading…</div>
      ) : members.length === 0 ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>
          No members have generated events for this project yet.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
              {["Member", "Role", "Status"].map((h, i) => (
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
              const init = (m.name ?? m.email)
                .split(/[\s.@]/)
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase();
              const fauxAvatar = {
                id: m.id,
                name: m.name ?? m.email,
                init,
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
                        <div style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m.name ?? m.email}</div>
                        <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={cell({})}>
                    <Badge kind={m.role === "owner" ? "accent" : m.role === "lead" ? "info" : "neutral"}>
                      {m.role}
                    </Badge>
                  </td>
                  <td style={cell({})}>
                    <Badge kind={m.status === "active" ? "ok" : "neutral"}>{m.status}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
