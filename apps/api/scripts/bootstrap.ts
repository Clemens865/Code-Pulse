// First-run bootstrap: creates your org, its owner, and the owner's first
// workstation API key. This is the front door for a fresh install — no SQL
// needed.
//
//   npm run bootstrap -- --org "Northbeam Studio" --name "Ada Lovelace" --email ada@northbeam.dev
//
// Options:
//   --org    Organization display name              (required)
//   --email  Owner's email (used to sign in)        (required)
//   --name   Owner's display name                   (default: email local part)
//   --slug   Org slug                               (default: derived from --org)
//   --force  Allow creating an additional org when one already exists
//
// Prints ORG_ID / MEMBER_ID (for the dashboard's local sign-in) and the
// plaintext API_KEY (shown exactly once — it is stored only as an HMAC hash).

import { db, schema } from "../src/db/index.js";
import { generateApiKey } from "../src/lib/keys.js";

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[a.slice(2)] = next;
      i++;
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgName = typeof args.org === "string" ? args.org.trim() : "";
  const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";

  if (!orgName || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: npm run bootstrap -- --org "Org Name" --email you@example.com [--name "Your Name"] [--slug org-slug]');
    process.exit(2);
  }
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : email.split("@")[0]!;
  const slug = typeof args.slug === "string" && args.slug.trim() ? slugify(args.slug) : slugify(orgName);

  const existing = await db.query.orgs.findMany({ columns: { id: true, name: true, slug: true } });
  if (existing.length > 0 && args.force !== true) {
    console.error(`An org already exists (${existing.map((o) => `"${o.name}"`).join(", ")}).`);
    console.error("Use --force to create an additional org, or sign in to the existing one.");
    process.exit(1);
  }
  if (existing.some((o) => o.slug === slug)) {
    console.error(`Slug "${slug}" is taken — pass a different --slug.`);
    process.exit(1);
  }

  const [org] = await db
    .insert(schema.orgs)
    .values({ name: orgName, slug })
    .returning({ id: schema.orgs.id });
  if (!org) throw new Error("org insert returned no row");

  const [member] = await db
    .insert(schema.members)
    .values({
      orgId: org.id,
      email,
      name,
      role: "owner",
      status: "active",
      activatedAt: new Date(),
    })
    .returning({ id: schema.members.id });
  if (!member) throw new Error("member insert returned no row");

  const key = generateApiKey();
  await db.insert(schema.apiKeys).values({
    orgId: org.id,
    memberId: member.id,
    label: "bootstrap",
    keyHash: key.hash,
    keyLast4: key.last4,
  });

  console.log(`\nCreated org "${orgName}" (${slug}) with owner ${name} <${email}>.\n`);
  console.log("ORG_ID=" + org.id);
  console.log("MEMBER_ID=" + member.id);
  console.log("API_KEY=" + key.plaintext);
  console.log(`
Next steps:
  1. Dashboard: open the app and use local sign-in — your org and name are listed.
  2. Workstation hook:  code-pulse init --api-url <this API's URL> --api-key <API_KEY above>
  3. Invite teammates from Admin → Members.

The API key is shown only once. Rotate it any time from Admin → API keys.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[bootstrap] failed:", e);
  process.exit(1);
});
