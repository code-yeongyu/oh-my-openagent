import { describe, expect, test } from "bun:test"
import { findEmDashCopy, findUnexplainedSuppressions, isProductSource } from "./check-copy"

describe("no-em-dash-copy", () => {
  const path = "packages/example/src/copy.tsx"

  test.each([
    ['const label = "Refresh failed \u2014 retry";'],
    ["const label = `${name} \u2014 ${kind}`;"],
    ["const label = `Before \u2014 ${name}`;"],
    ["const label = `${name} \u2014`;"],
    ["const label = `Refresh \u2014 retry`;"],
    ["const node = <p>Run a prompt \u2014 on an interval</p>;"],
    ['const label = "Refresh \\u2014 retry";'],
    ["const label = `Refresh \\u{2014} retry`;"],
  ])("reports product copy: %s", (content) => {
    expect(findEmDashCopy(content, path)).toHaveLength(1)
  })

  test("allows comments, regex literals, hyphens and en dashes", () => {
    const content = '// Issue \u2014 Browser\nconst title = /[\u2013\u2014-]/u;\nconst label = "Refresh - retry 1\u20132";'
    expect(findEmDashCopy(content, path)).toEqual([])
  })

  test("reports each matching node at its source position", () => {
    expect(findEmDashCopy('const a = "-";\nconst b = "\u2014";', path)).toEqual([{ line: 2, column: 11 }])
  })

  test.each([
    "packages/example/src/copy.test.ts",
    "packages/example/src/copy.spec.tsx",
    "packages/example/src/__tests__/copy.ts",
    "packages/example/src/tests/copy.ts",
    "packages/example/src/testkit/copy.ts",
    "packages/example/src/fixtures/copy.ts",
    "packages/example/src/testUtils/copy.ts",
    "packages/example/src/testUtils.ts",
    "packages/example/src/_generated/copy.ts",
    "packages/example/src/copy.gen.ts",
    "packages/example/src/copy.generated.ts",
    "packages/shared-skills/skills/browser/scripts/copy.generated.js",
    "packages/shared-skills/skills/browser/scripts/vendor/copy.js",
    "packages/shared-skills/skills/browser/scripts/install-dist/copy.js",
    "packages/example/plugin/scripts/copy.mjs",
    "packages/example/src/vendor/copy.ts",
    "packages/example/plugin/dist/copy.js",
    "packages/shared-skills/upstreams/copy.ts",
    "packages/lsp-daemon/src/proxy.ts",
    "packages/lsp-tools-mcp/src/index.ts",
    "packages/omo-senpi/plugin/extensions/omo.js",
    "packages/omo-senpi/plugin/runtime/agent-toolkit-sdk/sdk.js",
    "packages/omo-senpi/src/components/ultrawork/generated-directive.ts",
    "packages/omo-codex/plugin/components/ultrawork/src/directive-content.ts",
    "docs/copy.md",
    "script/copy.ts",
  ])("exempts %s", (filename) => {
    expect(isProductSource(filename)).toBe(false)
    expect(findEmDashCopy('const label = "\u2014";', filename)).toEqual([])
  })

  test.each([
    "src/copy.ts",
    "app/copy.tsx",
    "lib/copy.js",
    "workers/copy.mts",
    "bin/oh-my-opencode.js",
    "packages/omo-native/bin/copy.js",
    "packages/omo-opencode/src/testing/create-plugin-module.ts",
    "packages/example/src/copy.ts",
    "packages/web/app/page.tsx",
    "packages/web/components/copy.tsx",
    "packages/web/lib/copy.mjs",
    "packages/example/plugin/components/copy.ts",
    "packages/shared-skills/skills/browser/scripts/browser-doctor.mjs",
    "packages/shared-skills/skills/browser/scripts/browser-install.mjs",
    "packages/shared-skills/skills/programming/scripts/typescript/check-no-excuse-rules.ts",
    "packages/omo-codex/plugin/scripts/sync-skills.mjs",
    "packages/omo-senpi/plugin/scripts/sync-skills.mjs",
  ])("checks %s", (filename) => {
    expect(isProductSource(filename)).toBe(true)
  })

  test("reports copy in shipped skill scripts", () => {
    expect(findEmDashCopy('console.log("Unavailable \\u2014 retry");',
      "packages/shared-skills/skills/browser/scripts/browser-doctor.mjs")).toHaveLength(1)
  })

  test.each([
    ["entities.mjs", 'const entities = { mdash: "\\u2014" };'],
    ["gates-text.mjs", 'const EM_DASH = "\\u2014";'],
  ])("allows punctuation data but still checks copy in %s", (filename, data) => {
    const filenamePath = `packages/shared-skills/skills/ulw-research/scripts/${filename}`
    expect(findEmDashCopy(data, filenamePath)).toEqual([])
    expect(findEmDashCopy(`${data}\nconsole.log("Unavailable \\u2014 retry");`, filenamePath)).toHaveLength(1)
  })

  test("allows the OXC em-dash rule's own EM_DASH constant but checks other copy in that file", () => {
    const path = "packages/shared-skills/skills/programming/scripts/typescript/oxc/lint/oxlint-plugin/no-em-dash-copy.js"
    const data = 'const EM_DASH = "\\u2014";'
    expect(findEmDashCopy(data, path)).toEqual([])
    expect(findEmDashCopy(`${data}\nconsole.log("Unavailable \\u2014 retry");`, path)).toHaveLength(1)
  })

  test("allows Senpi sync heading matcher data but checks other shipped copy", () => {
    const path = "packages/omo-senpi/plugin/scripts/sync-skills.mjs"
    const data = [
      'const before = "## ABSOLUTE RULE: YOU ARE AN ORCHESTRATOR \\u2014 NEVER THE IMPLEMENTER";',
      'const after = "## ABSOLUTE RULE (root session): YOU ARE AN ORCHESTRATOR \\u2014 NEVER THE IMPLEMENTER";',
    ].join("\n")
    expect(findEmDashCopy(data, path)).toEqual([])
    expect(findEmDashCopy(`${data}\nconsole.log("Unavailable \\u2014 retry");`, path)).toHaveLength(1)
  })
})

describe("require-suppression-reason", () => {
  const path = "packages/example/src/copy.tsx"

  test.each([
    "// oxlint-disable-next-line no-control-regex -- ANSI sequences start with ESC.",
    "/* eslint-disable no-console -- this script reports to the terminal */",
    "// Positions are stable.\n// oxlint-disable-next-line react/no-array-index-key",
    "// Invalid fixture.\n// @ts-expect-error\n// oxlint-disable-next-line no-unused-vars",
    "// @ts-expect-error the fixture passes a string on purpose",
    "// @ts-ignore: upstream types omit this property",
    "/* @ts-nocheck -- generated client types are checked separately */",
    "const el = <div>{/* oxlint-disable-next-line react/no-danger -- sanitized above */}</div>",
    "/* oxlint-enable no-console */",
    "// Positions are stable.\n//\n// eslint-disable-next-line no-shadow",
    "/* Positions\n * are stable. */\n// eslint-disable-next-line no-shadow",
    "// biome-ignore lint/suspicious/noExplicitAny: external payload has no schema",
    "// biome-ignore-all format: stable generated layout",
    "// biome-ignore-start lint/suspicious/noExplicitAny: external payload has no schema",
    "// External payload has no schema.\n// biome-ignore lint/suspicious/noExplicitAny:",
    'const text = "// @ts-ignore";',
    "const text = `\n// @ts-ignore\n`;",
    'const expression = /https?:\\/\\//;',
  ])("allows %s", (content) => {
    expect(findUnexplainedSuppressions(content, path)).toEqual([])
  })

  test.each([
    "// oxlint-disable-next-line no-control-regex",
    "/* oxlint-disable eslint/no-useless-escape */",
    "// eslint-disable-line no-unused-vars",
    "// eslint-disable no-console -- ",
    "// @ts-expect-error",
    "// @ts-ignore:",
    "/* @ts-nocheck */",
    "// Positions are stable.\n\n// eslint-disable-next-line no-shadow",
    "//\n/* */\n// oxlint-disable-next-line no-unused-vars",
    "const first = 1; // first value\nconst second = 2; // oxlint-disable-line no-unused-vars",
    "const el = <div>{/* eslint-disable-next-line react/no-danger */}</div>",
    "// biome-ignore lint/suspicious/noExplicitAny",
    "// biome-ignore-all format:",
    "// biome-ignore-start lint/suspicious/noExplicitAny",
    "// biome-ignore lint/suspicious/noExplicitAny:",
    "/* biome-ignore lint/suspicious/noExplicitAny: */",
    "// @ts-ignore\n// eslint-disable-next-line no-shadow",
  ])("reports %s", (content) => {
    expect(findUnexplainedSuppressions(content, path).length).toBeGreaterThan(0)
  })

  test("reports directive positions and uses the existing source scope", () => {
    expect(findUnexplainedSuppressions("const a = 1;\n// @ts-ignore\nconst b = 2", path))
      .toEqual([{ line: 2, column: 1 }])
    expect(findUnexplainedSuppressions("// @ts-ignore", "script/example.ts")).toEqual([])
    expect(findUnexplainedSuppressions("// @ts-ignore", "packages/example/src/copy.test.ts")).toEqual([])
  })
})
