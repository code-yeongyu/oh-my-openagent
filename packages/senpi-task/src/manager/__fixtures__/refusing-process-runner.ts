import type { ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { RpcProcessRunner } from "../../runners/rpc-process"
import { spawnFakeChild } from "../../runners/rpc/__fixtures__/spawn-fake"

/**
 * A real process runner over the scripted fake child: each launched model's child refuses its first prompt
 * with the wire payload `refusals` names for that model, and every other model's child serves the turn.
 * Spawned children are pushed onto `spawned` so the caller's afterEach can stop them.
 */
export function refusingProcessRunner(refusals: Readonly<Record<string, object>>, spawned: ChildProcess[]) {
  const launched: string[] = []
  const runner = new RpcProcessRunner({
    modelAdmission: async () => {},
    buildSpawn: (spec) => {
      launched.push(spec.model ?? "")
      const refusal = refusals[spec.model ?? ""]
      return {
        command: process.execPath,
        args: [],
        cwd: spec.cwd,
        env: { ...process.env, ...(refusal === undefined ? {} : { FAKE_PROMPT_REFUSAL: JSON.stringify(refusal) }) },
      }
    },
    spawnChild: (descriptor) => {
      const child = spawnFakeChild(descriptor.env)
      spawned.push(child)
      return child
    },
  })
  return { runner, launched }
}

export function taskEvents(stateDir: string, taskId: string): Array<{ type: string; payload: Record<string, unknown> }> {
  return readFileSync(join(stateDir, "logs", `${taskId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
}
