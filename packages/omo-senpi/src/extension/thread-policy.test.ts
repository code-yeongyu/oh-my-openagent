import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { createThreadComponent } from "../components/thread/component"
import { composeOmoSenpiExtension } from "./compose"

test.each([
  { policy: true, env: "0", count: 6 },
  { policy: false, env: "1", count: 0 },
  { policy: undefined, env: "1", count: 0 },
  { policy: true, env: undefined, count: 6 },
])("host policy $policy overrides ambient env $env", async ({ policy, env, count }) => {
  const stateDirectory = mkdtempSync(join(tmpdir(), "omo-thread-policy-"))
  const previous = process.env.OMO_ENABLE_SHARED_HOST
  const pi = Object.assign(new FakeExtensionAPI(), { sharedHostEnabled: policy })
  try {
    if (env === undefined) delete process.env.OMO_ENABLE_SHARED_HOST
    else process.env.OMO_ENABLE_SHARED_HOST = env

    await composeOmoSenpiExtension([createThreadComponent({ stateDirectory })])(pi)

    expect(pi.tools).toHaveLength(count)
    if (count > 0) {
      expect(pi.tools.map((tool) => tool.name)).toEqual([
        "thread_create", "thread_list", "thread_read",
        "thread_send", "thread_interrupt", "thread_handoff",
      ])
      for (const tool of pi.tools) {
        expect(tool.exposure).toBe("search")
        expect(tool.allowLazyActivation).toBe(true)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.OMO_ENABLE_SHARED_HOST
    else process.env.OMO_ENABLE_SHARED_HOST = previous
    rmSync(stateDirectory, { recursive: true, force: true })
  }
})
