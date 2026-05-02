// One-shot script: creates a smoke-test org, member, and API key, prints the
// plaintext token. Use with `node --env-file=.env --import tsx scripts/seed-smoke.ts`.

import { db, schema } from "../src/db/index.js";
import { generateApiKey } from "../src/lib/keys.js";

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const MEMBER_ID = "00000000-0000-0000-0000-0000000000a1";

async function main() {
  await db
    .insert(schema.orgs)
    .values({ id: ORG_ID, name: "Smoke", slug: "smoke" })
    .onConflictDoNothing();

  await db
    .insert(schema.members)
    .values({
      id: MEMBER_ID,
      orgId: ORG_ID,
      email: "smoke@example.com",
      name: "Smoke",
      role: "owner",
      status: "active",
    })
    .onConflictDoNothing();

  const key = generateApiKey();
  await db.insert(schema.apiKeys).values({
    orgId: ORG_ID,
    memberId: MEMBER_ID,
    label: "smoke",
    keyHash: key.hash,
    keyLast4: key.last4,
  });

  console.log("ORG_ID=" + ORG_ID);
  console.log("MEMBER_ID=" + MEMBER_ID);
  console.log("API_KEY=" + key.plaintext);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
