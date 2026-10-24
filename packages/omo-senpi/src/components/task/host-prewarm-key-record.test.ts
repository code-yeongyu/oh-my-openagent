import { describe, expect, test } from "bun:test"
import { chmodSync } from "node:fs"
import { join } from "node:path"

import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { configureSharedSubunitLogger } from "@oh-my-opencode/utils/logger"

import { withContractHost } from "../../../../senpi-task/src/runners/rpc-host/testing/contract-host"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { wireHostPrewarm } from "./host-prewarm"
import { TaskRuntimeContext } from "./runtime-context"
import { sessionCtx } from "./host-prewarm.test-support"

// Key records are a POSIX contract; win32 hosts use the raw-secret pipe transport and never read one.
describe.skipIf(process.platform === "win32")("host pre-warm against an unsafe key record", () => {
  test("#given an enforcing host whose key record is group-readable #when the first prompt warms it #then the warm is refused unsafe_key_record, logged, and the session goes on", async () => {
    await withContractHost({ auth: true, prepareRecord: (path) => chmodSync(path, 0o644) }, async (host) => {
      const lines: string[] = []
      configureSharedSubunitLogger((message, data) => { lines.push(`${message} ${JSON.stringify(data)}`) })
      try {
        const pi = new FakeExtensionAPI()
        const runtime = new TaskRuntimeContext(host.root)
        const prewarm = wireHostPrewarm(pi, {
          settings: OmoTaskSettingsSchema.parse({ process_runner: "host", host_shard_prewarm: "first-turn" }),
          stateDir: join(host.root, "store"),
          runtime: { captureFrom: (ctx) => runtime.captureFrom(ctx), sessionId: () => runtime.sessionId(), cwd: () => runtime.cwd() },
          // No warmHost seam: the production default (warmTaskHost over askHost) runs against the host.
          host: {
            agentDir: host.root,
            executionModeGate: { warm: async () => undefined, current: () => "process" },
            hostEndpoint: { isOwn: () => false, ensure: async () => "ensured" },
            shardSocket: () => host.socket,
          },
          manager: { list: () => [] },
        }, "darwin")

        await pi.dispatch("input", { type: "input", text: "hi", source: "interactive" }, sessionCtx("root-1"))
        await prewarm.settled("root-1")

        expect(host.frames.map(({ frame }) => frame.type)).toEqual(["get_protocol_info"])
        expect(lines.filter((line) => line.includes("omo-senpi task host warm failed") && line.includes("unsafe_key_record"))).toHaveLength(1)
      } finally {
        configureSharedSubunitLogger(undefined)
      }
    })
  })
})
