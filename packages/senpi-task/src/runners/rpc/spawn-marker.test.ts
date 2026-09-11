import { describe, expect, test } from "bun:test"

import { OMO_SENPI_TASK_RPC_CHILD, buildRpcSpawn } from "./spawn"

const baseSpec = {
  task_id: "st_1a2b3c4d",
  cwd: "/tmp/project",
  state_dir: "/tmp/project/.omo/senpi-task",
  prompt: "do the work",
} as const

const noExecutable = { resolveSenpiExecutable: () => null }

describe("RPC child marker", () => {
  test("#given a parent environment #when building an RPC child #then the dedicated marker is forced on", () => {
    const descriptor = buildRpcSpawn(baseSpec, {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux",
      parentEnv: {},
      resolveRpcEntry: () => "/rpc-entry.js",
      ...noExecutable,
    })

    expect(descriptor.env[OMO_SENPI_TASK_RPC_CHILD]).toBe("1")
  })

  test("#given member environment attempts to override the marker #when building an RPC child #then the child marker remains enabled", () => {
    const descriptor = buildRpcSpawn(
      {
        ...baseSpec,
        memberEnv: {
          [OMO_SENPI_TASK_RPC_CHILD]: "0",
        },
      },
      {
        isBunBinary: false,
        execPath: "/usr/bin/node",
        platform: "linux",
        parentEnv: {},
        resolveRpcEntry: () => "/rpc-entry.js",
        ...noExecutable,
      },
    )

    expect(descriptor.env[OMO_SENPI_TASK_RPC_CHILD]).toBe("1")
  })
})
