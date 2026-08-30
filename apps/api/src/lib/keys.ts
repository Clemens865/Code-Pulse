// API key hashing — HMAC-SHA-256 with a server-side pepper.
// Format: cpt_<base32-32B>. last4 stored plaintext for display.

import { createHmac, randomBytes } from "node:crypto";
import { env } from "../env.js";

const KEY_PREFIX = "cpt_";

function base32Encode(bytes: Uint8Array): string {
  // Crockford base32 (no padding)
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const idx = (value >>> bits) & 0x1f;
      out += alphabet[idx];
    }
  }
  if (bits > 0) {
    const idx = (value << (5 - bits)) & 0x1f;
    out += alphabet[idx];
  }
  return out;
}

export function generateApiKey() {
  const raw = randomBytes(32);
  const token = KEY_PREFIX + base32Encode(raw);
  return {
    plaintext: token,
    last4: token.slice(-4),
    hash: hashApiKey(token),
  };
}

export function hashApiKey(plaintext: string): Uint8Array {
  return new Uint8Array(
    createHmac("sha256", env.API_KEY_PEPPER).update(plaintext).digest(),
  );
}

export function isProbablyApiKey(s: string): boolean {
  return s.startsWith(KEY_PREFIX) && s.length >= KEY_PREFIX.length + 16;
}
