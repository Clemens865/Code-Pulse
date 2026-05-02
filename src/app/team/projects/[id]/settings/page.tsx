"use client";

import Link from "next/link";

export default function ProjectSettingsPage() {
  return (
    <div style={{ padding: 24, flex: 1, overflow: "auto" }}>
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 18,
          maxWidth: 640,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Project settings</h2>
        <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 8 }}>
          Renaming, redaction policy, and access control are managed centrally for all
          projects in your org.
        </p>
        <Link
          href="/team/admin/projects"
          style={{
            display: "inline-block",
            marginTop: 12,
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          Open admin → Projects →
        </Link>
      </div>
    </div>
  );
}
