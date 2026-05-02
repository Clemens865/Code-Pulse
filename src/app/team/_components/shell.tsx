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
  defaultPersona,
  insights as sampleInsights,
  timelineSeed,
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

type Source = "sample" | "live" | "needs-login";

type ShellCtx = {
  openPalette: () => void;
  persona: Persona;
  timeline: TimelineEvent[];
  insights: Insight[];
  source: Source;
  loading: boolean;
  reload: () => void;
};

const ShellContext = createContext<ShellCtx>({
  openPalette: () => {},
  persona: defaultPersona,
  timeline: timelineSeed,
  insights: sampleInsights,
  source: "sample",
  loading: false,
  reload: () => {},
});

export function useShell() {
  return useContext(ShellContext);
}

export function TeamShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [persona, setPersona] = useState<Persona>(defaultPersona);
  const [timeline, setTimeline] = useState<TimelineEvent[]>(timelineSeed);
  const [insights, setInsights] = useState<Insight[]>(sampleInsights);
  const [source, setSource] = useState<Source>("sample");
  const [loading, setLoading] = useState(true);

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
    (async () => {
      try {
        const [me, projects, members, tl, ins] = await Promise.all([
          api.me(),
          api.projects(),
          api.members(),
          api.timeline(50),
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
        if (err instanceof ApiError && err.status === 401) {
          setSource("needs-login");
        } else {
          setSource("sample");
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
    () => ({ openPalette, persona, timeline, insights, source, loading, reload }),
    [openPalette, persona, timeline, insights, source, loading, reload],
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
      {source === "sample" && !loading && <SampleBanner />}
      {source === "needs-login" && !loading && <DevLoginCard onLoggedIn={reload} />}
    </div>
  );
}

function SampleBanner() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        padding: "6px 10px",
        background: "var(--status-warn-bg)",
        color: "var(--status-warn-fg)",
        border: "1px solid var(--status-warn-border)",
        borderRadius: 6,
        fontSize: 11,
        fontFamily: "var(--font-sans)",
        zIndex: 40,
      }}
    >
      Sample data · API unreachable
    </div>
  );
}

function DevLoginCard({ onLoggedIn }: { onLoggedIn: () => void }) {
  const SMOKE_ORG = "00000000-0000-0000-0000-000000000001";
  const SMOKE_MEMBER = "00000000-0000-0000-0000-0000000000a1";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.devLogin(SMOKE_ORG, SMOKE_MEMBER);
      onLoggedIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
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
      }}
    >
      <div
        style={{
          width: 380,
          background: "var(--bg)",
          borderRadius: 10,
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-modal)",
          padding: 20,
          textAlign: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Sign in</h2>
        <p style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 8 }}>
          The team API requires a session. In dev, sign in as the smoke owner —
          real OAuth is the next sprint.
        </p>
        <button
          type="button"
          onClick={signIn}
          disabled={busy}
          style={{
            marginTop: 14,
            width: "100%",
            background: "var(--accent)",
            color: "var(--fg-on-accent)",
            border: "1px solid transparent",
            borderRadius: 6,
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in as Smoke (dev)"}
        </button>
        {err && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--status-err-fg)" }}>{err}</div>
        )}
      </div>
    </div>
  );
}
