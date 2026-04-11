import { describe, expect, test } from "bun:test"

import {
  readBeadsRuntimeInProgress,
  readBeadsRuntimeIssueDetails,
  readBeadsRuntimeReady,
  resolveBeadsRuntimeCommandCwd,
} from "./index"
import type { BeadsRuntimeCommandRunner } from "./br-command-runner"
import { BeadsRuntimeError } from "./errors"

function createRunner(outputs: Record<string, { exitCode: number; stdout?: string; stderr?: string }>, calls: Array<{ command: string; cwd: string }>): BeadsRuntimeCommandRunner {
  return async ({ command, cwd }) => {
    calls.push({ command: command.join(" "), cwd })
    return outputs[command.join(" ")] ?? { exitCode: 1, stderr: "missing" }
  }
}

describe("beads runtime br cli", () => {
  test("reads ready, in-progress, and show json using the resolved bead worktree cwd", async () => {
    const calls: Array<{ command: string; cwd: string }> = []
    const cwd = resolveBeadsRuntimeCommandCwd({
      directory: "/repo",
      state: { bead_worktree_path: "/repo/worktree", worktree_path: "/repo" },
    })

    const runner = createRunner({
      "br --help": { exitCode: 0, stdout: "usage" },
      "br ready --help": { exitCode: 0, stdout: "--json" },
      "br list --help": { exitCode: 0, stdout: "--status\n--json" },
      "br show --help": { exitCode: 0, stdout: "--json" },
      "br ready --json": { exitCode: 0, stdout: JSON.stringify([{ id: "bd-1", title: "Ready item" }]) },
      "br list --status in_progress --json": {
        exitCode: 0,
        stdout: JSON.stringify({
          issues: [{ id: "bd-2", title: "Claimed item" }],
          total: 1,
          limit: 50,
          offset: 0,
          has_more: false,
        }),
      },
      "br show bd-2 --json": { exitCode: 0, stdout: JSON.stringify([{ id: "bd-2", title: "Claimed item", description: "detail" }]) },
    }, calls)

    await expect(readBeadsRuntimeReady({ cwd, runner })).resolves.toEqual([{ id: "bd-1", title: "Ready item" }])
    await expect(readBeadsRuntimeInProgress({ cwd, runner })).resolves.toMatchObject({
      issues: [{ id: "bd-2", title: "Claimed item" }],
      total: 1,
      has_more: false,
    })
    await expect(readBeadsRuntimeIssueDetails({ beadID: "bd-2", cwd, runner })).resolves.toEqual([
      { id: "bd-2", title: "Claimed item", description: "detail" },
    ])

    expect(new Set(calls.map((call) => call.cwd))).toEqual(new Set(["/repo/worktree"]))
  })

  test("fails closed when show support is unavailable or json is malformed", async () => {
    const calls: Array<{ command: string; cwd: string }> = []
    const runner = createRunner({
      "br --help": { exitCode: 0, stdout: "usage" },
      "br ready --help": { exitCode: 0, stdout: "--json" },
      "br list --help": { exitCode: 0, stdout: "--status\n--json" },
      "br show --help": { exitCode: 1, stderr: "unsupported" },
    }, calls)

    await expect(readBeadsRuntimeIssueDetails({ beadID: "bd-2", cwd: "/repo", runner })).rejects.toThrow(BeadsRuntimeError)

    const malformedRunner = createRunner({
      "br --help": { exitCode: 0, stdout: "usage" },
      "br ready --help": { exitCode: 0, stdout: "--json" },
      "br list --help": { exitCode: 0, stdout: "--status\n--json" },
      "br show --help": { exitCode: 0, stdout: "--json" },
      "br show bd-2 --json": { exitCode: 0, stdout: "{" },
    }, [])

    await expect(readBeadsRuntimeIssueDetails({ beadID: "bd-2", cwd: "/repo", runner: malformedRunner })).rejects.toThrow(BeadsRuntimeError)
  })
})
