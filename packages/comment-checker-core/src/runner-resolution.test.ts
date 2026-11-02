import { expect, it } from "bun:test"

for (const name of ["ResolveMessage", "UnrelatedFailure"] as const) {
  it(`handles ${name} when legacy npm resolution throws a non-Error value`, async () => {
    // given an isolated resolver with the pre-Bun-1.4 thrown-value contract
    const program = `
      import { mock } from "bun:test"
      import assert from "node:assert/strict"
      import * as nodeModule from "node:module"
      const failure = { name: ${JSON.stringify(name)}, message: "missing package" }
      mock.module("node:module", () => ({
        ...nodeModule,
        createRequire: () => { throw failure },
      }))
      try {
        const { resolveCommentCheckerBinary } = await import(${JSON.stringify(new URL("./runner.ts", import.meta.url).href)})
        const resolveBinary = () => resolveCommentCheckerBinary({
          binaryName: "comment-checker", cachedBinaryPath: null,
          existsSync: () => false, importMetaUrl: import.meta.url,
        })
        if (failure.name === "ResolveMessage") assert.equal(resolveBinary(), null)
        else assert.throws(resolveBinary, (error) => error === failure)
      } finally {
        mock.restore()
      }
    `

    // when the legacy package probe runs
    const child = Bun.spawn([process.execPath, "-e", program], {
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(10_000),
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

    // then only a missing-package resolution failure degrades to a cache miss
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
  })
}
