import { describe, expect, it } from "bun:test"
import { CODEGRAPH_PINNED_VERSION, type CodegraphProvisionResult } from "@oh-my-opencode/utils"
import { installCodegraphForOpenCode } from "./install-codegraph"

describe("installCodegraphForOpenCode", () => {
  it("#given a successful provisioner #when installing #then it provisions into the default ~/.omo/codegraph dir with the pinned version", async () => {
    // given
    const calls: Array<{ readonly installDir?: string; readonly lockDir: string; readonly version: string }> = []
    const provisionedPath = "/home/tester/.omo/codegraph/bin/codegraph"
    const provisioner = async (options: {
      readonly installDir?: string
      readonly lockDir: string
      readonly version: typeof CODEGRAPH_PINNED_VERSION
    }): Promise<CodegraphProvisionResult> => {
      calls.push(options)
      return { binPath: provisionedPath, provisioned: true }
    }

    // when
    await installCodegraphForOpenCode({
      homeDir: "/home/tester",
      provisioner,
    })

    // then
    expect(calls).toEqual([
      {
        installDir: "/home/tester/.omo/codegraph",
        lockDir: "/home/tester/.omo/codegraph/locks",
        version: CODEGRAPH_PINNED_VERSION,
      },
    ])
  })

  it("#given a failing provisioner #when installing #then it logs a warning and does not throw", async () => {
    // given
    const warnings: string[] = []
    const provisioner = async (): Promise<CodegraphProvisionResult> => {
      return { error: "download failed with HTTP 503", provisioned: false }
    }

    // when
    await installCodegraphForOpenCode({
      homeDir: "/home/tester",
      log: (message) => warnings.push(message),
      provisioner,
    })

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("download failed with HTTP 503")
  })

  it("#given a throwing provisioner #when installing #then it logs a warning and does not throw", async () => {
    // given
    const warnings: string[] = []
    const provisioner = async (): Promise<CodegraphProvisionResult> => {
      throw new Error("no CodeGraph asset for linux-x64")
    }

    // when
    await installCodegraphForOpenCode({
      homeDir: "/home/tester",
      log: (message) => warnings.push(message),
      provisioner,
    })

    // then
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("no CodeGraph asset for linux-x64")
  })
})
