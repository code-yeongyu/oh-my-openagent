import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { AtomicSpawn, AtomicSpawnOutcome, AtomicSpawnRequest } from "../process"

const FIXTURE_DIR = join(import.meta.dirname, "0.22.1")

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8")
}

export function exited(stdout: string, exitCode = 0, stderr = ""): AtomicSpawnOutcome {
  return { kind: "exited", exitCode, stdout, stderr }
}

export function createReplaySpawn(respond: (request: AtomicSpawnRequest) => AtomicSpawnOutcome): {
  readonly spawn: AtomicSpawn
  readonly requests: AtomicSpawnRequest[]
} {
  const requests: AtomicSpawnRequest[] = []
  return {
    requests,
    spawn: async (request) => {
      requests.push(request)
      return respond(request)
    },
  }
}
