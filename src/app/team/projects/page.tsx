"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { I } from "../_components/icons";
import {
  AvatarStack,
  Badge,
  Btn,
  Sparkline,
  cell,
} from "../_components/primitives";
import { Topbar } from "../_components/topbar";
import { useShell } from "../_components/shell";
import { FilterDropdown, FilterRangeChip } from "../_components/filter-dropdown";

const sparkPattern = [3, 5, 4, 7, 9, 6, 11, 8, 12, 14, 11, 17];

const STATUS_OPTIONS = [
  { id: "active", label: "Active" },
  { id: "needs_review", label: "Needs review" },
];

const REDACTION_OPTIONS = [
  { id: "standard", label: "Standard" },
  { id: "strict", label: "Strict" },
];

const ACTIVITY_OPTIONS: Array<{ id: "any" | "active7d" | "active30d" | "dormant"; label: string }> = [
  { id: "any", label: "Any" },
  { id: "active7d", label: "Active in last 7d" },
  { id: "active30d", label: "Active in last 30d" },
  { id: "dormant", label: "Dormant (>30d)" },
];

function activityWithinDays(lastActivity: string, days: number): boolean {
  // lastActivity is OG-style relative ("2m" / "11h" / "1d" / "30d")
  // We treat it as "≤ days" by parsing the unit + magnitude.
  const m = /^(\d+)([smhd])$/.exec(lastActivity);
  if (!m || !m[1] || !m[2]) return false;
  const n = parseInt(m[1], 10);
  const u = m[2];
  const ageDays = u === "s" ? 0 : u === "m" ? 0 : u === "h" ? 0 : u === "d" ? n : 0;
  return ageDays <= days;
}

export default function ProjectListPage() {
  const { openPalette, persona } = useShell();
  const router = useRouter();

  const [statuses, setStatuses] = useState<string[]>([]);
  const [redactions, setRedactions] = useState<string[]>([]);
  const [activity, setActivity] = useState<"any" | "active7d" | "active30d" | "dormant">("any");

  const ps = useMemo(() => {
    return persona.projects.filter((p) => {
      if (statuses.length > 0) {
        const matchesActive = statuses.includes("active") && !p.needsReview;
        const matchesNeedsReview = statuses.includes("needs_review") && p.needsReview;
        if (!matchesActive && !matchesNeedsReview) return false;
      }
      if (redactions.length > 0 && !redactions.includes(p.redaction)) return false;
      if (activity === "active7d" && !activityWithinDays(p.lastActivity, 7)) return false;
      if (activity === "active30d" && !activityWithinDays(p.lastActivity, 30)) return false;
      if (activity === "dormant" && activityWithinDays(p.lastActivity, 30)) return false;
      return true;
    });
  }, [persona.projects, statuses, redactions, activity]);

  const needsReviewCount = persona.projects.filter((p) => p.needsReview).length;
  const anyActive = statuses.length + redactions.length > 0 || activity !== "any";
  const clearAll = () => {
    setStatuses([]);
    setRedactions([]);
    setActivity("any");
  };

  return (
    <>
      <Topbar breadcrumbs={["Projects"]} onOpenPalette={openPalette} />
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Projects
          </h1>
          {needsReviewCount > 0 && (
            <Badge kind="warn" icon={<I.flag />}>
              {needsReviewCount} needs review
            </Badge>
          )}
          <span style={{ flex: 1 }} />
          <Btn kind="ghost" icon={<I.download />}>
            Export CSV
          </Btn>
          <Btn kind="primary" icon={<I.plus />}>
            Bind project
          </Btn>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {anyActive && (
            <>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 10px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  background: "transparent",
                  color: "var(--fg-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  cursor: "pointer",
                }}
              >
                <I.filter /> Clear filters
              </button>
              <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 2px" }} />
            </>
          )}
          <FilterDropdown
            label="Status"
            options={STATUS_OPTIONS}
            selected={statuses}
            onChange={setStatuses}
          />
          <FilterDropdown
            label="Redaction"
            options={REDACTION_OPTIONS}
            selected={redactions}
            onChange={setRedactions}
          />
          <FilterRangeChip
            label="Activity"
            options={ACTIVITY_OPTIONS}
            value={activity}
            onChange={setActivity}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>
            {ps.length} of {persona.projects.length} projects
          </span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
              {["Project", "Members", "Sessions (7d)", "Activity", "Open blockers", "Last activity", "Redaction", ""].map((h, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: i >= 1 && i <= 4 ? "right" : "left",
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
            {ps.map((p) => (
              <tr
                key={p.id}
                onClick={(e) => {
                  // Don't navigate when clicking nested interactive elements.
                  const t = e.target as HTMLElement;
                  if (t.closest("a, button")) return;
                  router.push(`/team/projects/${p.id}`);
                }}
                style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                <td style={cell({ left: true })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 5,
                        background: `oklch(0.92 0.04 ${p.hue})`,
                        color: `oklch(0.35 0.13 ${p.hue})`,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    >
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          color: "var(--fg-strong)",
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Link
                          href={`/team/projects/${p.id}`}
                          style={{ color: "inherit", textDecoration: "none" }}
                        >
                          {p.name}
                        </Link>
                        {p.needsReview && (
                          <Badge kind="warn" icon={<I.flag />}>
                            Needs review
                          </Badge>
                        )}
                      </div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                        {p.repo}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={cell({ right: true })}>
                  <AvatarStack
                    ms={persona.members.filter((m) => m.projects.includes(p.id))}
                    max={4}
                  />
                </td>
                <td style={cell({ right: true, num: true })}>
                  <span style={{ fontWeight: 500 }}>{p.sessions7d}</span>
                </td>
                <td style={cell({ right: true })}>
                  <Sparkline
                    data={sparkPattern.map((v) => v * (p.sessions7d / 100))}
                    stroke={`oklch(0.55 0.13 ${p.hue})`}
                  />
                </td>
                <td style={cell({ right: true, num: true })}>
                  {p.blockers > 0 ? (
                    <Badge kind="err" icon={<I.blocker />}>
                      {p.blockers}
                    </Badge>
                  ) : (
                    <span style={{ color: "var(--fg-faint)" }}>—</span>
                  )}
                </td>
                <td style={cell({ num: true })}>
                  <span style={{ color: "var(--fg-muted)" }}>{p.lastActivity} ago</span>
                </td>
                <td style={cell({})}>
                  <Badge kind={p.redaction === "strict" ? "info" : "neutral"}>{p.redaction}</Badge>
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
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
