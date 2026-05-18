/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowChecks = [
  {
    path: new URL("../.github/workflows/ci.yml", import.meta.url),
    testRuns: [
      "run: bun test",
      "run: bun test src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: new URL("../.github/workflows/publish.yml", import.meta.url),
    testRuns: ["run: bun test"],
  },
]

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })

  test("publish workflow generates alias main package from a temp directory", () => {
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")

    expect(workflow).toMatch(/- name: Publish oh-my-opencode[\s\S]*?if: steps\.check\.outputs\.skip != 'true'/)
    expect(workflow).toMatch(/- name: Publish oh-my-openagent[\s\S]*?if: steps\.check-openagent\.outputs\.skip != 'true'/)
    expect(workflow).toMatch(/- name: Publish oh-my-openagent[\s\S]*?ALIAS_OUT="\$RUNNER_TEMP\/oh-my-openagent-main"/)
    expect(workflow).toMatch(/- name: Publish oh-my-openagent[\s\S]*?bun run script\/publish\/build-alias-package\.ts --source \. --out "\$ALIAS_OUT" --version "\$VERSION"/)
    expect(workflow).toMatch(/- name: Publish oh-my-openagent[\s\S]*?cd "\$ALIAS_OUT"/)
    expect(workflow).toContain('uses: ./.github/workflows/publish-platform.yml')
  })

  test("publish-platform workflow fails when a required artifact download is missing", () => {
    const workflow = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8")

    expect(workflow).toContain("continue-on-error: true")
    expect(workflow).toContain("- name: Fail if required artifact download failed")
    expect(workflow).toContain('steps.check.outputs.skip_all != \'true\' && steps.download.outcome != \'success\'')
    expect(workflow).toContain('echo "::error::Required artifact binary-${{ matrix.platform }} could not be downloaded"')
  })

  test("publish-platform workflow checks and publishes both canonical and alias package families", () => {
    const workflow = readFileSync(new URL("../.github/workflows/publish-platform.yml", import.meta.url), "utf8")

    expect(workflow).toContain('https://registry.npmjs.org/oh-my-opencode-${{ matrix.platform }}/${VERSION}')
    expect(workflow).toContain('https://registry.npmjs.org/oh-my-openagent-${{ matrix.platform }}/${VERSION}')
    expect(workflow).toContain("if: steps.check.outputs.skip_opencode != 'true' && steps.download.outcome == 'success'")
    expect(workflow).toContain("if: steps.check.outputs.skip_openagent != 'true' && steps.download.outcome == 'success'")
    expect(workflow).toContain('cd packages/${{ matrix.platform }}')
    expect(workflow).toContain('ALIAS_OUT="$RUNNER_TEMP/oh-my-openagent-${{ matrix.platform }}"')
    expect(workflow).toContain('bun run script/publish/build-alias-platform-package.ts')
    expect(workflow).toContain('cd "$ALIAS_OUT"')
  })
})
