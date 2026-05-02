// Dashboard session auth.
// HMAC-signed cookie. In dev mode we expose /v1/auth/dev-login that lets you
// pick an org+member without OAuth. Real OAuth (Google/GitHub) lands in a later sprint.

import { createHmac, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context, Next } from "hono";
import { env } from "../env.js";
import { problem } from "../lib/errors.js";

const COOKIE_NAME = "cpt_session";
const ONE_MONTH_S = 60 * 60 * 24 * 30;

export type SessionPayload = {
  org_id: string;
  member_id: string;
  iat: number;
  exp: number;
};

declare module "hono" {
  interface ContextVariableMap {
    session: SessionPayload;
  }
}

function b64url(buf: Buffer | string) {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function issueSession(orgId: string, memberId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const p: SessionPayload = { org_id: orgId, member_id: memberId, iat: now, exp: now + ONE_MONTH_S };
  const payload = b64url(JSON.stringify(p));
  return `${payload}.${sign(payload)}`;
}

export function verifySession(cookie: string | undefined): SessionPayload | null {
  if (!cookie) return null;
  const idx = cookie.indexOf(".");
  if (idx === -1) return null;
  const payload = cookie.slice(0, idx);
  const sig = cookie.slice(idx + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig, "base64url");
  const b = Buffer.from(expected, "base64url");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as SessionPayload;
    if (p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch {
    return null;
  }
}

export function setSessionCookie(c: Context, value: string) {
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: ONE_MONTH_S,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

export async function dashboardAuth(c: Context, next: Next) {
  const cookie = getCookie(c, COOKIE_NAME);
  const session = verifySession(cookie);
  if (!session) return problem(c, 401, "unauthorized", "Missing or invalid session cookie");
  c.set("session", session);
  await next();
}
