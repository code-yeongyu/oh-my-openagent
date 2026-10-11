import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { runDaemonCommand } from "../bin/lib/daemon.js"
import { capture, scriptedEngine, workspace } from "./daemon-test-support"

describe("omo daemon gc store-index pruning", () => {
  test("#given explicit store-index pruning #when gc runs #then the bundled locked runtime owns the rewrite", () => {
    const { pluginRoot, agentDir } = workspace()
    const requests: Record<string, unknown>[] = []
    const migration = {
      run(request: Record<string, unknown>) {
        requests.push(request)
        return { removed: ["/tmp/missing-store"] }
      },
    }
    const engine = scriptedEngine(() => ({
      exitCode: 0,
      stdout: JSON.stringify({ removed: [], kept: [] }),
    }))
    const stdout = capture()

    const exitCode = runDaemonCommand(["gc", "--json", "--prune-store-index"], {
      engine,
      migration,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
    })

    expect(exitCode).toBe(0)
    expect(requests).toEqual([{
      operation: "prune-store-index",
      indexPath: join(agentDir, "rpc", "task-stores.json"),
    }])
    expect(JSON.parse(stdout.text()).pruned_stores).toEqual(["/tmp/missing-store"])
  })
})
