import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const trackedBundlePath = "packages/omo-codex/scripts/install-dist/install-local.mjs"

// Read from the git index for the same reason codex-install-bundle-freshness.test.ts does: a
// working-tree read can be rebuilt into agreement by a preceding build step and could never fail.
function readTrackedBundle(): string {
  const result = Bun.spawnSync(["git", "show", `:${trackedBundlePath}`], { cwd: repositoryRoot })
  if (result.exitCode !== 0) throw new Error(`git show :${trackedBundlePath} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

function harnessIds(source: string): string | undefined {
  return /OMO_CONFIG_HARNESS_IDS = (\[[^\]]*\])/.exec(source)?.[1]
}

describe("the committed Codex installer bundle tracks its transitive inputs", () => {
  // The bundle INLINES workspace dependencies, but the freshness digest walks only
  // packages/omo-codex/src/install. omo#8620 renamed the harness ids in omo-config-core, the
  // inlined copy went stale, and the existing guard still reported the bundle current - so the
  // nine test files and the runtime entrypoint that resolve install-dist/install-local.mjs from a
  // checkout all ran pre-#8620 behaviour.
  test("#given the tracked bundle #when its inlined harness ids are read #then they match the current config source", async () => {
    // given
    const bundle = readTrackedBundle()
    const source = await readFile(join(repositoryRoot, "packages/omo-config-core/src/schema/harness.ts"), "utf8")

    // when
    const bundled = harnessIds(bundle)
    const current = harnessIds(source)

    // then
    expect(current).toBeDefined()
    expect(bundled).toBe(current as string)
  })
})
