import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { isUserFacingPath, shippingPolicy } from "./changelog-shipping-policy.mjs"

// The changelog gate's definition of a shipped path (#10841 keeps it unchanged under fragments), checked against
// this repository's real tracked tree and manifests.
const root = fileURLToPath(new URL("..", import.meta.url))
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
const policy = shippingPolicy(tracked, (path) => readFileSync(join(root, path), "utf8"))
const manifestPolicy = (manifest: Record<string, unknown>) => shippingPolicy(["package.json"], () => JSON.stringify(manifest))

describe("shipped path classifier", () => {
  test.each([
    "packages/omo-opencode/src/tools/delegate-task/categories.ts",
    "packages/omo-senpi/src/components/onboarding/component.ts",
    "crates/senpi-desktop-backend-macos/src/ax/menus/select.rs",
    "crates/senpi-desktop-core/src/menus/mod.rs",
    "packages/omo-native/compile-entry.ts", "packages/omo-native/compiled-update.ts",
    "packages/omo-native/bin/lib/daemon-operations.js",
    "packages/omo-senpi/plugin/runtime/dag/sdk.js",
    "packages/omo-senpi/plugin/package.json",
    "packages/omo-senpi/plugin/daemon-launch-spec.json",
    "packages/omo-senpi/plugin/scripts/install.mjs",
    "packages/omo-opencode/src/testing/create-plugin-module.ts",
    "packages/omo-senpi/skills/onboarding/SKILL.md",
    "packages/shared-skills/skills/ulw-research/SKILL.md",
    "packages/prompts-core/prompts/ultrawork/codex.md",
    ".agents/skills/opencode-qa/SKILL.md",
    "bin/oh-my-opencode.js", "postinstall.mjs", "package.json",
    "script/build-binaries.ts", "script/build-omo-binary.ts", "script/build-omo-native.ts",
    "script/build.ts", "script/qa/strip-ansi.mjs",
  ])("requires a note for %s", (path) => {
    expect(tracked).toContain(path)
    expect(isUserFacingPath(path, policy)).toBe(true)
  })
  test.each([
    "packages/omo-senpi/src/components/onboarding/component.test.ts",
    "packages/omo-senpi/src/components/onboarding/test-harness.ts",
    "packages/isolation-core/src/backends/git-fixture.ts",
    "packages/isolation-core/src/merge/abandoned-concurrent-merge.fixture.ts",
    "packages/isolation-core/src/merge/merge-fixture.ts",
    "packages/omo-opencode/src/testing/module-mock-lifecycle.ts",
    "packages/omo-opencode/src/features/team-mode/test-support/async-test-helpers.ts",
    "crates/senpi-desktop-backend-macos/src/ax/menus/live_tests.rs",
    "crates/senpi-desktop-backend-macos/src/ax/menus/tests.rs",
    "packages/omo-senpi/plugin/extensions/omo.js",
    "packages/omo-codex/scripts/install-dist/install-local.mjs",
    "docs/reference/omo-ai-publishing.md", "README.md", "AGENTS.md", "changes.md",
    "scripts/check-third-party-notices.mjs",
    "script/qa/omo-native-eval-smoke-stop.mjs", "script/qa/omo-native-eval-smoke.mjs",
    ".github/workflows/ci.yml", "bun.lock",
  ])("does not require a note for %s", (path) => {
    expect(tracked).toContain(path)
    expect(isUserFacingPath(path, policy)).toBe(false)
  })
  test("uses manifest glob, bin and negative entries", () => {
    const packagePolicy = manifestPolicy({ files: ["assets/*.json", "!assets/private.json"], bin: { cli: "launcher.mjs" } })
    expect(isUserFacingPath("assets/runtime.json", packagePolicy)).toBe(true)
    expect(isUserFacingPath("assets/private.json", packagePolicy)).toBe(false)
    expect(isUserFacingPath("launcher.mjs", packagePolicy)).toBe(true)
    expect(isUserFacingPath("unpublished.mjs", packagePolicy)).toBe(false)
  })
})
