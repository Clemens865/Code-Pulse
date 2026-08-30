"use client";

import { use, useEffect, useState } from "react";
import { api } from "../../../_data/api";

export default function ProjectFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [hot, setHot] = useState<Array<{ path: string; edits: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.project(id)
      .then((r) => {
        if (!cancelled) setHot(r.hot_files ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const max = Math.max(1, ...hot.map((f) => f.edits));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Hot files</h3>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>edit + write count</span>
        </div>
        {loading ? (
          <div style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>Loading…</div>
        ) : hot.length === 0 ? (
          <div style={{ padding: 16, color: "var(--fg-faint)", fontSize: 12 }}>
            No edits tracked yet.
          </div>
        ) : (
          hot.map((f, i) => {
            const pct = (f.edits / max) * 100;
            return (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  borderBottom: i < hot.length - 1 ? "1px solid var(--border)" : "none",
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 50px",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <code className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>{f.path}</code>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "var(--bg-muted)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: 11.5,
                    color: "var(--fg-muted)",
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {f.edits}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
