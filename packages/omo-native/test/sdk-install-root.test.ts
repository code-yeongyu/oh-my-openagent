import { describe, expect, test } from "bun:test"

import { sdkRoot } from "../bin/lib/sdk-install.js"

// The install.sdkRoot row's scenario (reads-package-root): one read of the package's manifest, no write, and the
// answer is the directory of the omo-ai/sdk export's built file.
function recordingFs(manifest: unknown) {
  const reads: string[] = []
  return {
    reads,
    fs: {
      readFile: async (path: string) => {
        reads.push(path)
        return JSON.stringify(manifest)
      },
    },
  }
}

describe("install.sdkRoot", () => {
  test("#given a manifest whose ./sdk export names a built file #when sdkRoot runs #then it reads only the manifest and answers that file's directory", async () => {
    const { reads, fs } = recordingFs({
      exports: { "./sdk": { types: "./bin/lib/sdk/sdk.d.ts", default: "./bin/lib/sdk/sdk.js" } },
    })
    expect(await sdkRoot({}, { packageDir: "/pkg", fs })).toEqual({ kind: "ok", value: { path: "/pkg/bin/lib/sdk" } })
    expect(reads).toEqual(["/pkg/package.json"])
  })

  test("#given a manifest with no ./sdk export #when sdkRoot runs #then it answers not_implemented as data, naming the missing entry", async () => {
    const { fs } = recordingFs({ exports: { "./remote": "./bin/lib/remote.js" } })
    expect(await sdkRoot({}, { packageDir: "/pkg", fs })).toMatchObject({
      kind: "error",
      error: { code: "not_implemented", details: { entry: "omo-ai/sdk" } },
    })
  })
})
