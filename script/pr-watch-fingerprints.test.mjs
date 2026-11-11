import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { writeTestExecutable } from "./omob-test-executable"
import { buildBatches, decodeBatch, parsePullRequest, runCli } from "../.agents/skills/work-with-pr/scripts/pr-watch-fingerprints.mjs"

const NOW = 2_000_000
function response({ state = "OPEN", head = "abc", comments = 1, runs = [{ state: "SUCCESS", count: 2 }] } = {}) {
  return { data: { rateLimit: { cost: 1, remaining: 100 }, pr0: { pullRequest: {
    url: "https://github.com/acme/widget/pull/1", state, isDraft: false, mergeable: "MERGEABLE", headRefOid: head, baseRefOid: "base",
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { totalCount: 2, checkRunCountsByState: runs, statusContextCountsByState: [] } } } }] },
    comments: { totalCount: comments, nodes: [{ id: "comment", updatedAt: "2026-10-06" }] }, reviews: { totalCount: 0, nodes: [] }, reviewThreads: { totalCount: 0, nodes: [] },
  } } } }
}
const batch = buildBatches(["acme/widget#1"])[0]
function acknowledged(row) { return { [row.key]: { ...row, lastRemarksReadAt: NOW } } }

describe("batched PR watch fingerprint protocol", () => {
  test("CLI refuses to overwrite the acknowledged snapshot or accept missing flag values", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-fingerprint-test-"))
    const previous = join(dir, "previous.json")
    try {
      writeFileSync(previous, "{}\n")
      expect(() => runCli(["--previous", previous, "--output", previous, "acme/widget#1"])).toThrow("must not overwrite")
      expect(readFileSync(previous, "utf8")).toBe("{}\n")
      expect(() => runCli(["--output"])).toThrow("requires a path")
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  test("public CLI shares two GraphQL reads across 26 watches and never acknowledges detail reads", () => {
    // Maintainer #9493 requires a read-count regression: per-watch fetching would make 26 calls.
    // Exercise the executable boundary instead of adding a test-only fetch injection seam.
    const dir = mkdtempSync(join(tmpdir(), "pr-fingerprint-cli-"))
    const log = join(dir, "reads.jsonl")
    const gh = join(dir, process.platform === "win32" ? "gh.exe" : "gh")
    try {
      // Windows requires a native executable; a POSIX shebang fixture is not runnable there.
      writeTestExecutable(gh, `const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.PR_FINGERPRINT_READ_LOG, JSON.stringify(args) + "\\n");
const query = args[3];
const data = { rateLimit: { cost: 1, remaining: 100 } };
for (const [, alias] of query.matchAll(/(pr[0-9]+): repository/g)) {
  data[alias] = { pullRequest: ${JSON.stringify(response().data.pr0.pullRequest)} };
}
process.stdout.write(JSON.stringify({ data }));
`)
      const output = execFileSync(process.execPath, [
        "./.agents/skills/work-with-pr/scripts/pr-watch-fingerprints.mjs",
        ...Array.from({ length: 26 }, (_, i) => `acme/widget#${i + 1}`),
      ], { encoding: "utf8", env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, PR_FINGERPRINT_READ_LOG: log } })
      const reads = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      expect(reads.length).toBe(2)
      expect(reads.every((args) => args[0] === "api" && args[1] === "graphql")).toBe(true)
      const rows = JSON.parse(output).batches.flatMap(({ rows }) => rows)
      expect(rows.length).toBe(26)
      expect(rows.every((row) => row.result === "ok" && row.refreshStatus && row.refreshRemarks && row.lastRemarksReadAt === null)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 60_000)
  test("bounds each GraphQL pass to 25 distinct PRs and validates user input", () => {
    const batches = buildBatches([...Array.from({ length: 26 }, (_, i) => `acme/widget#${i + 1}`), "acme/widget#1"])
    expect(batches.map(({ refs }) => refs.length)).toEqual([25, 1])
    expect(batches[0].query).toContain("rateLimit { cost remaining resetAt }")
    expect(() => parsePullRequest('acme/widget#1) { viewer { login } }')).toThrow()
    expect(() => parsePullRequest("acme/widget#0")).toThrow()
    expect(() => parsePullRequest("acme/widget#9007199254740993")).toThrow()
  })
  test("unchanged completed checks skip reads; status and remarks invalidate independently", () => {
    const first = decodeBatch(batch, response(), {}, NOW).rows[0]
    const previous = acknowledged(first)
    const unchanged = decodeBatch(batch, response(), previous, NOW + 60_000).rows[0]
    expect([unchanged.refreshStatus, unchanged.refreshRemarks, unchanged.checksRunning]).toEqual([false, false, false])
    const status = decodeBatch(batch, response({ head: "def" }), previous, NOW + 60_000).rows[0]
    expect([status.refreshStatus, status.refreshRemarks]).toEqual([true, false])
    const remarks = decodeBatch(batch, response({ comments: 2 }), previous, NOW + 60_000).rows[0]
    expect([remarks.refreshStatus, remarks.refreshRemarks]).toEqual([false, true])
  })
  test("running checks always read details; activity is forced after 30 minutes without claiming acknowledgment", () => {
    const running = response({ runs: [{ state: "IN_PROGRESS", count: 1 }, { state: "SUCCESS", count: 1 }] })
    const first = decodeBatch(batch, running, {}, NOW).rows[0]
    const row = decodeBatch(batch, running, acknowledged(first), NOW + 60_000).rows[0]
    expect([row.refreshStatus, row.checksRunning, row.refreshRemarks]).toEqual([true, true, false])
    const refresh = decodeBatch(batch, running, acknowledged(first), NOW + 30 * 60_000).rows[0]
    expect(refresh.refreshRemarks).toBe(true)
    expect(refresh.lastRemarksReadAt).toBe(NOW)
  })
  test("missing and partially errored rows fail open; rate limit skips without replacing baseline", () => {
    const missing = decodeBatch(batch, { data: { pr0: null } }, {}, NOW).rows[0]
    expect([missing.result, missing.refreshStatus, missing.refreshRemarks]).toEqual(["unreadable", true, true])
    const partial = response()
    partial.errors = [{ path: ["pr0", "pullRequest", "reviews"], message: "Unavailable" }]
    expect(decodeBatch(batch, partial, {}, NOW).rows[0].result).toBe("unreadable")
    const limited = decodeBatch(batch, { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }, {}, NOW).rows[0]
    expect([limited.result, limited.refreshStatus, limited.refreshRemarks]).toEqual(["rate_limited", false, false])
    expect(limited.statusFingerprint).toBeUndefined()
  })
})
