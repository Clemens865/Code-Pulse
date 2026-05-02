"use client";

import { I } from "../_components/icons";
import { Avatar, Badge, Btn, Chip, cell } from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";

export default function MembersPage() {
  const { openPalette, persona } = useShell();
  const totalActive = persona.members.filter((m) => m.status === "active").length;

  return (
    <>
      <Topbar breadcrumbs={["Members"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Members
          </h1>
          <span style={{ fontSize: 12.5, color: "var(--fg-muted)" }}>
            {persona.members.length} total · {totalActive} active
          </span>
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>
            Export
          </Btn>
          <Btn kind="primary" icon={<I.plus />}>
            Invite member
          </Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Chip>
            <I.filter /> Filters
          </Chip>
          <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
          <Chip>
            Role <I.chevron />
          </Chip>
          <Chip>
            Status <I.chevron />
          </Chip>
          <Chip>
            Project <I.chevron />
          </Chip>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
              {["Member", "Role", "Projects", "Sessions (7d)", "Last seen", "API key", "Status", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i === 3 ? "right" : "left",
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
            {persona.members.map((m) => {
              const projects = persona.projects.filter((p) => m.projects.includes(p.id));
              const sessions = Math.round(40 + (m.hue % 50));
              const keyOk = m.status === "active";
              const emailHandle = m.name.toLowerCase().replace(" ", ".");
              const emailDomain =
                persona.org.name.toLowerCase().replace(/\s+/g, "") + ".studio";
              return (
                <tr key={m.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={cell({})}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar m={m} size={24} />
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m.name}</div>
                        <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                          {emailHandle}@{emailDomain}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={cell({})}>
                    <Badge
                      kind={
                        m.role === "Owner" ? "accent" : m.role === "Lead" ? "info" : "neutral"
                      }
                    >
                      {m.role}
                    </Badge>
                  </td>
                  <td style={cell({})}>
                    {projects.length > 0 ? (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {projects.map((p) => (
                          <span
                            key={p.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 11.5,
                              color: "var(--fg-muted)",
                            }}
                          >
                            <span
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: 2,
                                background: `oklch(0.65 0.13 ${p.hue})`,
                              }}
                            />
                            {p.name.split(" · ")[0]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ color: "var(--fg-faint)", fontSize: 11.5 }}>—</span>
                    )}
                  </td>
                  <td style={cell({ right: true, num: true })}>
                    {m.status === "invited" ? (
                      <span style={{ color: "var(--fg-faint)" }}>—</span>
                    ) : (
                      sessions
                    )}
                  </td>
                  <td style={cell({})}>
                    <span style={{ color: "var(--fg-muted)" }}>{m.last} ago</span>
                  </td>
                  <td style={cell({})}>
                    {m.status === "invited" ? (
                      <Badge kind="neutral">No key</Badge>
                    ) : keyOk ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 11.5,
                          color: "var(--fg-muted)",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "oklch(0.7 0.15 145)",
                          }}
                        />
                        <code className="mono" style={{ fontSize: 11 }}>
                          cpt_••••e2a4
                        </code>
                      </span>
                    ) : (
                      <Badge kind="stale">Stale 4d</Badge>
                    )}
                  </td>
                  <td style={cell({})}>
                    {m.status === "active" && <Badge kind="ok">Active</Badge>}
                    {m.status === "stale" && <Badge kind="stale">Sync stale</Badge>}
                    {m.status === "invited" && <Badge kind="warn">Invite pending</Badge>}
                  </td>
                  <td style={cell({ pad: "6px 14px" })}>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
