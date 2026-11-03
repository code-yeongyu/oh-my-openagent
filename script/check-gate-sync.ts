#!/usr/bin/env bun
/**
 * Changelog-gate sync check (run inside a consuming repo): verifies the vendored copies from
 * sisyphuslabs/common-infra modules/changelog-gate/ are byte-identical to the canonical files.
 * Primary mode compares against the canonical on the default branch via `gh api` (needs a token
 * that can read that repo — the consumer's default GITHUB_TOKEN CANNOT; set a PAT or App). Fallback mode
 * `--expect <sha256> <file>` pins a hash recorded at vendor time for repos whose CI cannot
 * reach the canonical repo.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CANONICAL_REPO = "sisyphuslabs/common-infra";
const FILES = [
  "modules/changelog-gate/changelog-gate-rules.ts",
  "modules/changelog-gate/changelog-gate-rules.test.ts",
  "modules/changelog-gate/check-gate-sync.ts",
] as const;

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
const args = process.argv.slice(2);
let failed = false;

if (args[0] === "--expect") {
  const [, expected, file] = args;
  if (!expected || !file) throw new Error("usage: bun scripts/check-gate-sync.ts --expect <sha256> <file>");
  const actual = sha(readFileSync(file, "utf8"));
  const same = actual === expected;
  console.log(`${same ? "OK" : "DRIFT"} ${file} (pinned)`);
  if (!same) failed = true;
} else {
  const ref = args[0] ?? "main";
  for (const canonicalPath of FILES) {
    const vendored = canonicalPath.split("/").pop() as string;
    const local = readFileSync(join(import.meta.dir, vendored), "utf8");
    const canonical = execFileSync(
      "gh",
      ["api", `repos/${CANONICAL_REPO}/contents/${canonicalPath}?ref=${encodeURIComponent(ref)}`, "-H", "Accept: application/vnd.github.raw+json"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const same = sha(local) === sha(canonical);
    console.log(`${same ? "OK" : "DRIFT"} ${vendored} vs ${CANONICAL_REPO}@${ref}:${canonicalPath}`);
    if (!same) failed = true;
  }
}

if (failed) {
  console.error("the vendored changelog-gate files drifted from the canonical copy; re-vendor them");
  process.exit(1);
}
