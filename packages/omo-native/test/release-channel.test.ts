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
    expect(updateTarget("/prefix/lib/node_modules/omo-ai", "linux", "5.0.0-0.beta.90").command).toBe(
      "npm i -g omo-ai@beta",
    )
  })

  test("#given a bun global install #then the bun command follows the same channel", () => {
    const root = "/home/u/.bun/install/global/node_modules/omo-ai"
    expect(updateTarget(root, "linux", "5.0.0")).toMatchObject({ manager: "bun", argv: ["bun", "add", "-g", "omo-ai"] })
    expect(updateTarget(root, "linux", "5.0.1-beta.1")).toMatchObject({
      manager: "bun",
      argv: ["bun", "add", "-g", "omo-ai@beta"],
    })
  })
})

// #9281: npm 11 blocks install scripts by default and its own suggested fix lacks the package spec.
describe("updateTarget npm allow-scripts handling", () => {
  const home = "/home/someone"
  test("#given npm 11 install scripts to allow #when an npm target lists them #then the flag follows the package spec and the command stays runnable", () => {
    const target = updateTarget("/prefix/lib/node_modules/omo-ai", "linux", "5.0.0", home, () => false, undefined, [
      "esbuild",
      "@google/genai",
    ])
    expect(target.command).toBe("npm i -g omo-ai --allow-scripts=esbuild,@google/genai")
    expect(target.argv).toEqual(["npm", "i", "-g", "omo-ai", "--allow-scripts=esbuild,@google/genai"])
  })
  test("#given no scripts to allow #when an npm target is built #then no flag is appended", () => {
    const target = updateTarget("/prefix/lib/node_modules/omo-ai", "linux", "5.0.0", home, () => false)
    expect(target.command).toBe("npm i -g omo-ai")
  })
  test("#given a bun global install #when scripts are listed #then the bun command is unchanged", () => {
    const root = `/home/someone${"/.bun/install/global/node_modules/omo-ai"}`
    const target = updateTarget(root, "linux", "5.0.0", home, () => false, undefined, ["esbuild"])
    expect(target.command).toBe("bun add -g omo-ai")
  })
})
