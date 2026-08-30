import { describe, expect, it } from "vitest";
import { normalizeRemoteUrl } from "./projects.js";

describe("normalizeRemoteUrl", () => {
  it.each([
    ["https://github.com/Owner/Repo.git", "github.com/owner/repo"],
    ["git@github.com:Owner/Repo.git", "github.com/owner/repo"],
    ["https://user:tok@gitlab.com/grp/proj.git", "gitlab.com/grp/proj"],
    ["ssh://git@bitbucket.org/team/repo", "bitbucket.org/team/repo"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeRemoteUrl(input).canonicalKey).toBe(expected);
  });

  it("all remote formats of one repo share a canonical key", () => {
    const keys = [
      "https://github.com/acme/store.git",
      "git@github.com:acme/store.git",
      "https://github.com/Acme/Store",
    ].map((u) => normalizeRemoteUrl(u).canonicalKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("local paths stay distinct per path", () => {
    const a = normalizeRemoteUrl("local:/Users/a/proj").canonicalKey;
    const b = normalizeRemoteUrl("local:/Users/b/proj").canonicalKey;
    expect(a).not.toBe(b);
  });
});
