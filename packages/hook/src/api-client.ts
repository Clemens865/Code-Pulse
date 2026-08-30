// Tiny typed fetch wrapper for the Code Pulse API.

export type IngestEvent = {
  id: string;
  kind: string;
  session_id?: string;
  project: { remote_url: string; vcs_provider?: string; vcs_repo_id?: string };
  client: { hook_version?: string; os?: string; cloud_env?: string; hostname?: string };
  hook_ts: string;
  payload: Record<string, unknown>;
};

export type IngestResult = {
  received: number;
  accepted: number;
  duplicates: number;
  rejected: Array<{ id: string; reason: string; detail?: string }>;
  results: Array<{ id: string; status: "accepted" | "duplicate" | "rejected" }>;
};

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private url(path: string) {
    return this.baseUrl.replace(/\/$/, "") + path;
  }

  async health(): Promise<{ ok: boolean; status: number }> {
    try {
      const r = await fetch(this.url("/v1/health"), {
        method: "GET",
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      return { ok: r.ok, status: r.status };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async ingest(events: IngestEvent[]): Promise<{
    status: number;
    body?: IngestResult;
    error?: string;
  }> {
    try {
      const r = await fetch(this.url("/v1/events"), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ v: 1, events }),
      });
      const text = await r.text();
      if (r.ok || r.status === 207) {
        return { status: r.status, body: JSON.parse(text) as IngestResult };
      }
      return { status: r.status, error: text };
    } catch (err) {
      return { status: 0, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
