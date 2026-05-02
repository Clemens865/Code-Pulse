"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, Badge } from "../../../_components/primitives";
import { useShell } from "../../../_components/shell";
import { adaptApiTimeline, api } from "../../../_data/api";
import { type TimelineEvent } from "../../../_data/sample";

export default function ProjectTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { persona } = useShell();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.timeline(100, id).then((r) => {
      if (!cancelled) setEvents(adaptApiTimeline(r.events));
    }).catch(() => {}).finally(() => {
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
      ) : events.length === 0 ? (
        <div style={{ padding: 24, color: "var(--fg-faint)" }}>No events yet for this project.</div>
      ) : (
        events.map((e, idx) => {
          const m = memberById(e.member);
          const Wrapper = ({ children }: { children: React.ReactNode }) =>
            e.session_id ? (
              <Link
                href={`/team/sessions/${e.session_id}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 24px 1fr",
                  alignItems: "start",
                  gap: 12,
                  padding: "var(--row-pad-y) 24px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                {children}
              </Link>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 24px 1fr",
                  alignItems: "start",
                  gap: 12,
                  padding: "var(--row-pad-y) 24px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 13,
                }}
              >
                {children}
              </div>
            );
          return (
            <Wrapper key={idx}>
              <div
                style={{
                  color: "var(--fg-faint)",
                  fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums",
                  paddingTop: 2,
                }}
              >
                {e.t} ago
              </div>
              <div>{m && <Avatar m={m} size={20} />}</div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontWeight: 500, color: "var(--fg-strong)" }}>{m?.name ?? "—"}</span>
                  <Badge kind="neutral">{e.kind}</Badge>
                </div>
                <div style={{ marginTop: 3, color: "var(--fg)", lineHeight: 1.45 }}>{e.text}</div>
              </div>
            </Wrapper>
          );
        })
      )}
    </div>
  );
}
