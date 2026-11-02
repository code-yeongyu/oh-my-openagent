import { describe, expect, test } from "bun:test"

import {
  OMO_SENPI_TASK_DEPTH,
  OMO_SENPI_TASK_ROOT_SESSION_ID,
  OMO_SENPI_TASK_RPC_CHILD,
  OMO_SENPI_TASK_TRACEPARENT,
  buildRpcSpawn,
} from "./spawn"

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

  test("#given a parent that is itself a depth-1 child #when it launches its own child #then the child env carries the child's depth, never the parent's", () => {
    const runtime = {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux" as const,
      parentEnv: { [OMO_SENPI_TASK_DEPTH]: "1", [OMO_SENPI_TASK_ROOT_SESSION_ID]: "root" },
      resolveRpcEntry: () => "/rpc-entry.js",
      ...noExecutable,
    }

    const withDepth = buildRpcSpawn({ ...baseSpec, depth: 2, root_session_id: "root" }, runtime)
    const withoutDepth = buildRpcSpawn(baseSpec, runtime)

    expect(withDepth.env[OMO_SENPI_TASK_DEPTH]).toBe("2")
    expect(withDepth.env[OMO_SENPI_TASK_ROOT_SESSION_ID]).toBe("root")
    expect(withoutDepth.env[OMO_SENPI_TASK_DEPTH]).toBeUndefined()
    expect(withoutDepth.env[OMO_SENPI_TASK_ROOT_SESSION_ID]).toBeUndefined()
  })

  test("#given a delegating turn's traceparent #when a child is launched #then the child env carries exactly that traceparent, and a parent's own inherited one never leaks to a child launched without one", () => {
    const inherited = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    const delegating = "00-4bf92f3577b34da6a3ce929d0e0e4736-b7ad6b7169203331-01"
    const runtime = {
      isBunBinary: false,
      execPath: "/usr/bin/node",
      platform: "linux" as const,
      parentEnv: { [OMO_SENPI_TASK_TRACEPARENT]: inherited },
      resolveRpcEntry: () => "/rpc-entry.js",
      ...noExecutable,
    }

    const withTrace = buildRpcSpawn({ ...baseSpec, traceparent: delegating }, runtime)
    const withoutTrace = buildRpcSpawn(baseSpec, runtime)

    expect(withTrace.env[OMO_SENPI_TASK_TRACEPARENT]).toBe(delegating)
    expect(withoutTrace.env[OMO_SENPI_TASK_TRACEPARENT]).toBeUndefined()
  })
})
