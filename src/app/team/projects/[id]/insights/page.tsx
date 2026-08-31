"use client";

import { use, useEffect, useState } from "react";
import { I } from "../../../_components/icons";
import { Avatar, Badge } from "../../../_components/primitives";
import { useShell } from "../../../_components/shell";
import { adaptApiInsights, api } from "../../../_data/api";
import { type Insight, type InsightTag } from "../../../_data/sample";

const TAG_MAP: Record<InsightTag, ["accent" | "err" | "ok" | "info" | "neutral", () => React.ReactElement, string]> = {
  decision: ["accent", () => <I.decision />, "Decision"],
  blocker: ["err", () => <I.blocker />, "Blocker"],
  progress: ["ok", () => <I.progress />, "Progress"],
  pattern: ["info", () => <I.insights />, "Pattern"],
  fix: ["neutral", () => <I.insights />, "Fix"],
  context: ["neutral", () => <I.insights />, "Context"],
};

export default function ProjectInsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { persona } = useShell();
  const [items, setItems] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.insights({ projects: [id] })
      .then((r) => {
        if (!cancelled) setItems(adaptApiInsights(r.insights));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const memberById = (mid: string) => persona.members.find((m) => m.id === mid);

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      {loading ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>
          No insights for this project yet.
        </div>
      ) : (
        items.map((it, idx) => {
          const m = memberById(it.member);
          const tm = TAG_MAP[it.type] ?? TAG_MAP.context;
          return (
            <div
              key={idx}
              style={{
                padding: "12px 24px",
                borderBottom: "1px solid var(--border)",
                display: "grid",
                gridTemplateColumns: "120px 1fr auto",
                gap: 14,
                alignItems: "start",
              }}
            >
              <Badge kind={tm[0]} icon={tm[1]()}>
                {tm[2]}
              </Badge>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--fg-strong)" }}>
                  {it.title}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 3, lineHeight: 1.5 }}>
                  {it.text}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 11.5,
                  color: "var(--fg-faint)",
                }}
              >
                {m && <Avatar m={m} size={16} />}
                <span>{m?.name ?? "—"}</span>
                <span>·</span>
                <span>{it.t} ago</span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
