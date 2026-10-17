import { describe, expect, test } from "bun:test"

import { channelPackageSpec, releaseChannel, updateTarget } from "../bin/lib/package-paths.js"

describe("omo-ai release channel", () => {
  test("#given a stable version #then it ships on latest and installs as the bare package", () => {
    expect(releaseChannel("5.0.0")).toBe("latest")
    expect(channelPackageSpec("5.0.0")).toBe("omo-ai")
    expect(updateTarget("/prefix/lib/node_modules/omo-ai", "linux", "5.0.0").command).toBe("npm i -g omo-ai")
  })

  test("#given a prerelease version #then it ships on beta and installs with the beta tag", () => {
    expect(releaseChannel("5.0.0-0.beta.90")).toBe("beta")
    expect(channelPackageSpec("5.0.0-0.beta.90")).toBe("omo-ai@beta")
    expect(updateTarget("/prefix/lib/node_modules/omo-ai", "linux", "5.0.0-0.beta.90").command).toBe("npm i -g omo-ai@beta")
  })

  test("#given a bun global install #then the bun command follows the same channel", () => {
    const root = "/home/u/.bun/install/global/node_modules/omo-ai"
    expect(updateTarget(root, "linux", "5.0.0")).toMatchObject({ manager: "bun", argv: ["bun", "add", "-g", "omo-ai"] })
    expect(updateTarget(root, "linux", "5.0.1-beta.1")).toMatchObject({ manager: "bun", argv: ["bun", "add", "-g", "omo-ai@beta"] })
  })
})
