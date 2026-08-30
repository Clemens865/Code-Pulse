import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://cpt:cpt@localhost:56432/cpt_dev",
  },
  strict: true,
  verbose: true,
} satisfies Config;
