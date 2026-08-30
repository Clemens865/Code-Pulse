"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type Insight,
  type Persona,
  type TimelineEvent,
} from "../_data/sample";
import {
  adaptApiInsights,
  adaptApiPersona,
  adaptApiTimeline,
  api,
  ApiError,
} from "../_data/api";
import { Sidebar } from "./sidebar";
import { CommandPalette } from "./command-palette";

type Source = "loading" | "live" | "needs-login" | "error";

const EMPTY_PERSONA: Persona = {
  org: { name: "—", short: "—", plan: "—", logo: "—" },
  members: [],
  projects: [],
};

type ShellCtx = {
  openPalette: () => void;
  persona: Persona;
  timeline: TimelineEvent[];
  insights: Insight[];
  source: Source;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

const ShellContext = createContext<ShellCtx>({
  openPalette: () => {},
  persona: EMPTY_PERSONA,
  timeline: [],
  insights: [],
  source: "loading",
  loading: true,
  error: null,
  reload: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}

export function TeamShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [persona, setPersona] = useState<Persona>(EMPTY_PERSONA);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [source, setSource] = useState<Source>("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK =
        (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (isCmdK) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSource("loading");
    (async () => {
      try {
        const [me, projects, members, tl, ins] = await Promise.all([
          api.me(),
          api.projects(),
          api.members(),
          api.timeline({ limit: 50 }),
          api.insights({}),
        ]);
        if (cancelled) return;
        const adapted = adaptApiPersona(me.org, members.members, projects.projects);
        setPersona(adapted);
        setTimeline(adaptApiTimeline(tl.events));
        setInsights(adaptApiInsights(ins.insights));
        setSource("live");
      } catch (err) {
        if (cancelled) return;
        setPersona(EMPTY_PERSONA);
        setTimeline([]);
        setInsights([]);
        if (err instanceof ApiError && err.status === 401) {
          setSource("needs-login");
        } else {
          setSource("error");
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  const ctx = useMemo<ShellCtx>(
    () => ({ openPalette, persona, timeline, insights, source, loading, error, reload }),
    [openPalette, persona, timeline, insights, source, loading, error, reload],
  );

  return (
    <div
      className="cp-app"
      data-theme="light"
      data-accent="blue"
      data-density="compact"
      style={{
        minHeight: "100vh",
        display: "flex",
        background: "var(--bg)",
      }}
    >
      <Sidebar persona={persona} onOpenPalette={openPalette} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>
      </main>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      {source === "error" && !loading && (
        <ApiErrorBanner message={error} onRetry={reload} />
      )}
      {source === "needs-login" && !loading && <DevLoginCard onLoggedIn={reload} />}
    </div>
  );
}

function ApiErrorBanner({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        padding: "10px 14px",
        background: "var(--status-err-bg)",
        color: "var(--status-err-fg)",
        border: "1px solid var(--status-err-border)",
        borderRadius: 6,
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: 460,
      }}
    >
      <span>API unreachable{message ? ` — ${message}` : ""}</span>
      <button
        type="button"
        onClick={onRetry}
        style={{
          padding: "3px 8px",
          background: "transparent",
          border: "1px solid currentColor",
          borderRadius: 4,
          color: "inherit",
          fontFamily: "inherit",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}

function DevLoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [orgs, setOrgs] = useState<Awaited<ReturnType<typeof api.devList>>["orgs"] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // memberId being signed in
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .devList()
      .then((d) => setOrgs(d.orgs))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load identities"));
  }, []);

  const signIn = async (orgId: string, memberId: string) => {
    setBusy(memberId);
    setErr(null);
    try {
      await api.devLogin(orgId, memberId);
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "oklch(0.15 0.01 240 / 0.30)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 20,
      }}
    >
      <div
        style={{
          width: 460,
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          padding: 20,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Sign in</h2>
        <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 6, marginBottom: 16 }}>
          Pick your identity. New install? Run <code>npm run bootstrap</code> in{" "}
          <code>apps/api</code> to create your org.
        </p>

        {!orgs && !err && (
          <div style={{ fontSize: 12.5, color: "var(--fg-faint)" }}>Loading identities…</div>
        )}
        {err && (
          <div
            style={{
              fontSize: 12,
              color: "var(--status-err-fg)",
              background: "var(--status-err-bg)",
              border: "1px solid var(--status-err-border)",
              padding: "8px 10px",
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        {orgs?.map((org) => (
          <div key={org.id} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                marginBottom: 6,
                paddingBottom: 4,
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-strong)" }}>
                {org.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                {org.plan} · {org.members.length} member{org.members.length === 1 ? "" : "s"}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {org.members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => signIn(org.id, m.id)}
                  disabled={busy !== null}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    background: "transparent",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: busy ? "wait" : "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: `oklch(0.62 0.13 ${hashHue(m.id)})`,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {(m.name || m.email).split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--fg-strong)" }}>
                      {m.name || m.email}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                      {m.email} · {m.role}
                    </div>
                  </span>
                  {busy === m.id && (
                    <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>signing in…</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function hashHue(s: string): number {
  const hues = [212, 156, 28, 340, 268, 192, 86, 12];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return hues[h % hues.length];
}
