import { defineConfig } from "vitest/config";

// Unit tests import modules whose import chain reaches env.ts, which
// hard-exits without a valid environment. Provide harmless values — unit
// tests never open a real connection.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      API_KEY_PEPPER: "test-pepper-0123456789abcdef0123456789abcdef",
      SESSION_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
      HEALTH_DEEP_TOKEN: "test-canary-0123456789abcdef",
    },
  },
});
