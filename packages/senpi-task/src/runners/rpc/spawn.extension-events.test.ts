import { describe, expect, test } from "bun:test"

import { buildRpcSpawn } from "./spawn"

const baseSpec = {
  task_id: "st_1a2b3c4d",
  cwd: "/tmp/project",
  state_dir: "/tmp/project/.omo/senpi-task",
  prompt: "do the work",
} as const

// A runtime that never finds a real executable, isolating the fallback path deterministically.
const noExecutable = { resolveSenpiExecutable: () => null }

describe("buildRpcSpawn extension_events client capability", () => {
  const spawnWith = (parentEnv: NodeJS.ProcessEnv) =>
    buildRpcSpawn(baseSpec, {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux",
      parentEnv,
      resolveRpcEntry: () => "/rpc-entry.js",
      ...noExecutable,
    })

  test("#given no client capabilities #when building #then the child advertises extension_events", () => {
    const descriptor = spawnWith({ PATH: "/usr/bin" })
    expect(descriptor.env.SENPI_RPC_CLIENT_CAPABILITIES).toBe("extension_events")
  })

  test("#given an inherited comma-separated capability list #when building #then extension_events is appended with a comma", () => {
    const descriptor = spawnWith({ PATH: "/usr/bin", SENPI_RPC_CLIENT_CAPABILITIES: "a,b" })
    expect(descriptor.env.SENPI_RPC_CLIENT_CAPABILITIES).toBe("a,b,extension_events")
  })

  test("#given extension_events already advertised #when building #then the list is unchanged", () => {
    const descriptor = spawnWith({ PATH: "/usr/bin", SENPI_RPC_CLIENT_CAPABILITIES: "a,extension_events" })
    expect(descriptor.env.SENPI_RPC_CLIENT_CAPABILITIES).toBe("a,extension_events")
  })
})
