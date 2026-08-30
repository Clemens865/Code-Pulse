// Tiny typed fetch wrapper for the Code Pulse API.
export class ApiClient {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    url(path) {
        return this.baseUrl.replace(/\/$/, "") + path;
    }
    async health() {
        try {
            const r = await fetch(this.url("/v1/health"), {
                method: "GET",
                headers: { authorization: `Bearer ${this.apiKey}` },
            });
            return { ok: r.ok, status: r.status };
        }
        catch {
            return { ok: false, status: 0 };
        }
    }
    async ingest(events) {
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
                return { status: r.status, body: JSON.parse(text) };
            }
            return { status: r.status, error: text };
        }
        catch (err) {
            return { status: 0, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
//# sourceMappingURL=api-client.js.map