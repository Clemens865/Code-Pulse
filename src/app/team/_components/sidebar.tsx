"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { I } from "./icons";
import { Avatar, Badge, Kbd } from "./primitives";
import type { Persona } from "../_data/sample";

type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: (typeof I)[keyof typeof I];
  badge?: "live";
};

const navItems: NavItem[] = [
  { id: "overview", href: "/team", label: "Overview", icon: I.overview },
  { id: "timeline", href: "/team/timeline", label: "Timeline", icon: I.timeline, badge: "live" },
  { id: "projects", href: "/team/projects", label: "Projects", icon: I.projects },
  { id: "members", href: "/team/members", label: "Members", icon: I.members,  },
  { id: "insights", href: "/team/insights", label: "Insights", icon: I.insights },
  { id: "reports", href: "/team/reports", label: "Reports", icon: I.reports },
];

const adminItems: Array<{ id: string; href: string; label: string }> = [
  { id: "admin-members", href: "/team/admin/members", label: "Members & roles" },
  { id: "admin-projects", href: "/team/admin/projects", label: "Projects" },
  { id: "admin-keys", href: "/team/admin/keys", label: "API keys" },
  { id: "admin-audit", href: "/team/admin/audit", label: "Audit log" },
];

function isActive(pathname: string, href: string) {
  if (href === "/team") return pathname === "/team";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  collapsed = false,
  persona,
  onOpenPalette,
}: {
  collapsed?: boolean;
  persona: Persona;
  onOpenPalette?: () => void;
}) {
  const pathname = usePathname() ?? "/team";
  const w = collapsed ? 56 : 224;
  return (
    <aside
      style={{
        width: w,
        flexShrink: 0,
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        display: "flex",
        flexDirection: "column",
        transition: "width var(--dur-med) var(--ease-std)",
      }}
    >
      {/* Org switcher */}
      <button
        type="button"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: 8,
          padding: "7px 8px",
          borderRadius: 6,
          border: "1px solid transparent",
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--fg)",
        }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            flexShrink: 0,
            borderRadius: 5,
            background: "var(--accent)",
            color: "var(--fg-on-accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          {persona.org.logo}
        </span>
        {!collapsed && (
          <>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: 600,
                fontSize: 12.5,
              }}
            >
              {persona.org.name}
            </span>
            <I.chevron style={{ color: "var(--fg-faint)" }} />
          </>
        )}
      </button>

      {!collapsed && (
        <div style={{ margin: "0 8px 8px" }}>
          <button
            type="button"
            onClick={onOpenPalette}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg-faint)",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <I.search /> <span style={{ flex: 1 }}>Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", padding: "0 8px", gap: 1 }}>
        {navItems.map((it) => {
          const a = isActive(pathname, it.href);
          const Icon = it.icon;
          return (
            <Link
              key={it.id}
              href={it.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: collapsed ? "7px 10px" : "5px 8px",
                borderRadius: 6,
                color: a ? "var(--fg-strong)" : "var(--fg-muted)",
                background: a ? "var(--bg-active)" : "transparent",
                fontSize: 12.5,
                fontWeight: a ? 500 : 400,
                textDecoration: "none",
                justifyContent: collapsed ? "center" : "flex-start",
              }}
            >
              <Icon />
              {!collapsed && (
                <>
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.badge === "live" && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        color: "var(--fg-faint)",
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
                    </span>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div style={{ marginTop: 18, padding: "0 8px" }}>
          <div
            style={{
              padding: "4px 10px",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            Admin
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 2 }}>
            {adminItems.map((it) => {
              const showBadge =
                it.id === "admin-projects" &&
                persona.projects.filter((p) => p.needsReview).length > 0;
              return (
                <Link
                  key={it.id}
                  href={it.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "5px 10px 5px 28px",
                    borderRadius: 6,
                    color: "var(--fg-muted)",
                    fontSize: 12.5,
                    textDecoration: "none",
                  }}
                >
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {showBadge && (
                    <Badge kind="warn">
                      {persona.projects.filter((p) => p.needsReview).length}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: "auto",
          padding: 8,
          borderTop: "1px solid var(--sidebar-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
          <Avatar m={persona.members[0]} size={22} />
          {!collapsed && (
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {persona.members[0].name}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--fg-faint)" }}>
                {persona.org.plan}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
