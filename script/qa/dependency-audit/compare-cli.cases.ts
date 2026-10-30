import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { CASES } from "./contracts"
import { REPO, run } from "./runtime"

const digest = "a".repeat(64)
const timings = { mean: 1, stddev: 0, times: Array.from({ length: 30 }, () => 1), exit_codes: Array.from({ length: 30 }, () => 0) }
const behavior = {
  bytes: { size: 94_371_840, target: "darwin-arm64", sha256: digest },
  graph: { moduleCount: 1000, metafileSha256: digest },
  startup: { version: timings, oneshot: timings },
  rpc: { attached: true, workerTeardown: true, sessions: [
    { sessionId: "a", sentinel: "first", text: "first", stopReason: "stop" },
    { sessionId: "b", sentinel: "second", text: "second", stopReason: "stop" },
  ] },
  extension: { modes: ["classic", "multi"].map((mode) => ({ mode, sentinel: `audit-identity-${mode}`, label: `audit-identity-${mode}`, helperValue: 42,
    identity: { typebox: true, tui: true, engine: true } })) },
  photon: { width: 800, height: 400, wasResized: true, outputBytes: 100, independentlyDecoded: { width: 800, height: 400 } },
  changelog: { entriesMatchShipped: true, whatsNew: true, expectedEntries: ["fixture-entry"] },
  providers: { rows: ["classic", "multi"].flatMap((mode) => ["bedrock-converse-stream", "cursor-agent", "devin-agent"].map((api) => ({
    mode, api, requestObserved: true, stopReason: "error", failureClass: "auth", errorMessage: "401 Unauthorized",
  }))) },
  webfetch: { fixtures: ["reader", "tistory", "base"].map((path) => ({ path, markdown: "fixture", text: "fixture", status: 200, converted: true,
    finalUrl: `http://127.0.0.1:PORT/fixtures/${path}`, truncated: false, outputTruncated: false })) },
  skills: { entries: [{ path: "plugin/skills/fixture/SKILL.md", size: 7, sha256: digest }] },
  "bytes-targets": { targets: [] },
} as const

for (const scenario of ["valid", "oversized", "forged-photon", "mixed-artifacts", "missing-case", "other-target"] as const) {
  test(`compares through the CLI when receipts are ${scenario}`, async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "dependency-compare-test-"))
    try {
      const baseline = join(root, "baseline")
      const post = join(root, "post")
      for (const directory of [baseline, post]) {
        await mkdir(directory)
        for (const name of CASES) {
          if (directory === post && scenario === "missing-case" && name === "photon") continue
          const receipt = { schemaVersion: 1, case: name, machine: "test-machine", versions: { bun: "1.4.2", node: "24.0.0" },
            binarySha256: directory === post && scenario === "mixed-artifacts" && name === "photon" ? "b".repeat(64) : digest,
            pass: true, exitCode: 0, ...behavior[name],
            ...(name === "bytes" && (directory === baseline || scenario === "oversized") ? { size: 130850802 } : {}),
            ...(directory === post && scenario === "forged-photon" && name === "photon" ? { width: 1 } : {}),
            ...(directory === post && scenario === "other-target" && name === "bytes" ? { target: "linux-arm64", size: 120000000 } : {}),
          }
          await Bun.write(join(directory, `${name}.json`), JSON.stringify(receipt))
        }
      }
      // when
      const result = await run([process.execPath, join(REPO, "script/qa/dependency-audit-compare.ts"), "--baseline", baseline, "--post", post, "--gate", "p1"],
        { cwd: root, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 10000 })
      // then
      const expectedPass = scenario === "valid" || scenario === "other-target"
      expect(result.exitCode).toBe(expectedPass ? 0 : 1)
      if (scenario !== "missing-case") expect(z.object({ pass: z.boolean() }).parse(JSON.parse(result.stdout)).pass).toBe(expectedPass)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}
