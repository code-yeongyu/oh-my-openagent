/// <reference types="bun-types" />

import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The verifier pins the runtime artifacts that omo-ai must ship. `plugin/runtime/dag/sdk.js` is
 * load-bearing: the mass-ulw skill imports it through OMO_DAG_SDK_ROOT, so a packaging change that
 * drops it must fail the gate instead of shipping a skill that documents a dead import.
 *
 * The verifier resolves its package directory from its own location, so the guard is exercised by
 * copying it into a throwaway repo skeleton whose packages/omo-native manifest declares exactly the
 * payload under test.
 */
const verifierSource = fileURLToPath(new URL("./verify-omo-ai-payload.mjs", import.meta.url))
const npmInvocationSource = fileURLToPath(new URL("./npm-invocation.mjs", import.meta.url))
const generatedListSource = fileURLToPath(new URL("./generated-bundles.json", import.meta.url))
const requiredOutputsSource = fileURLToPath(new URL("./plugin-required-outputs.ts", import.meta.url))
const guardTimeoutMs = 120_000

setDefaultTimeout(guardTimeoutMs)

const PACKED_ARTIFACTS = [
  "bin/omo.js",
  "bin/lib/service-auth.generated.js",
  "plugin/package.json",
  "plugin/CHANGELOG.md",
  "plugin/extensions/omo.js",
  "plugin/extensions/gateway-store-worker.mjs",
  "plugin/extensions/omo-device-account.js",
  "plugin/extensions/omo-feedback.js",
  "plugin/skills-conditional/x-search/SKILL.md",
  "plugin/runtime/lsp-daemon/dist/cli.js",
  "plugin/runtime/ast-grep-mcp/cli.js",
  "plugin/runtime/dag/sdk.js",
  "plugin/runtime/agent-toolkit-sdk/sdk.js",
  "plugin/runtime/bunshin-ts/sdk.js",
  "plugin/runtime/thread-sdk/sdk.js",
  "plugin/runtime/category-coverage/index.js",
  "plugin/runtime/category-coverage/assets.generated.json",
  "plugin/runtime/task-config/index.js",
] as const

const CATEGORY_COVERAGE_BUNDLE = "plugin/runtime/category-coverage/index.js"
const CATEGORY_COVERAGE_ASSET = "plugin/runtime/category-coverage/assets.generated.json"
// The unminified read the 5.1.1 category-coverage bundle carries.
const BUNDLED_SIBLING_READ =
  'ASSETS_JSON_PATH=join3(dirname3(fileURLToPath2(import.meta.url)),"assets.generated.json");\n'
// The terser-minified shape of the same read in plugin/extensions/*.js.
const MINIFIED_SIBLING_READ = 'const a=t(i(o(import.meta.url)),"assets.generated.json");\n'

const PACKED_SKILL_COUNT = 23

const KEYCHAIN_HELPER = "bin/darwin/omo-keychain"

// Build outputs that are not tracked in git: publish-main must generate them before it packs (#13192).
const RELEASE_GENERATED_ARTIFACTS = [
  "bin/lib/service-auth.generated.js",
  "bin/lib/reflection-lock.generated.js",
  "bin/lib/brand-logo.generated.js",
  "plugin/scripts/install.mjs",
  "plugin/runtime/rollback-migrate.js",
] as const

// Every literal output the list names under a directory omo-ai ships (packages/omo-native -> package root,
// packages/omo-senpi/plugin -> plugin/). Read from the list itself: a newly listed output joins this table.
const LISTED_SHIPPED_LITERALS = (
  JSON.parse(readFileSync(generatedListSource, "utf8")) as { patterns: string[] }
).patterns
  .filter((pattern) => !/[[\](){}*+?|]/.test(pattern.slice(1, -1).replaceAll("\\.", "")))
  .map((pattern) => pattern.slice(1, -1).replaceAll("\\.", "."))
  .flatMap((path) =>
    path.startsWith("packages/omo-native/")
      ? [path.slice("packages/omo-native/".length)]
      : path.startsWith("packages/omo-senpi/plugin/")
        ? [`plugin/${path.slice("packages/omo-senpi/plugin/".length)}`]
        : [],
  )

interface VerifierRun {
  readonly exitCode: number
  readonly output: string
}

function writeFixtureFile(packageDir: string, relativePath: string, content: string): void {
  const target = join(packageDir, relativePath)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content, "utf8")
}

function runVerifierOnPayload(
  payloadPaths: readonly string[],
  contents: Readonly<Record<string, string>> = {},
  options: {
    readonly args?: readonly string[]
    readonly modes?: Readonly<Record<string, number>>
    readonly requiredPluginArtifacts?: readonly string[]
    readonly runtime?: string
    readonly env?: Readonly<Record<string, string | undefined>>
    readonly requirementsHelper?: string
    readonly generatedList?: string
  } = {},
): VerifierRun {
  const fakeRepoRoot = mkdtempSync(join(tmpdir(), "omo-ai-payload-guard-"))
  try {
    mkdirSync(join(fakeRepoRoot, "script"), { recursive: true })
    copyFileSync(verifierSource, join(fakeRepoRoot, "script", "verify-omo-ai-payload.mjs"))
    copyFileSync(npmInvocationSource, join(fakeRepoRoot, "script", "npm-invocation.mjs"))
    if (options.generatedList === undefined) {
      copyFileSync(generatedListSource, join(fakeRepoRoot, "script", "generated-bundles.json"))
    } else {
      writeFileSync(join(fakeRepoRoot, "script", "generated-bundles.json"), options.generatedList)
    }
    if (options.requirementsHelper === undefined) {
      copyFileSync(requiredOutputsSource, join(fakeRepoRoot, "script", "plugin-required-outputs.ts"))
    } else {
      writeFileSync(join(fakeRepoRoot, "script", "plugin-required-outputs.ts"), options.requirementsHelper)
    }
    // The installer's contract, read by the verifier through bun from the repository it runs in.
    const installDir = join(fakeRepoRoot, "packages", "omo-senpi", "src", "install")
    mkdirSync(installDir, { recursive: true })
    writeFileSync(
      join(installDir, "plugin-artifacts.ts"),
      `export const REQUIRED_PLUGIN_ARTIFACTS: readonly string[] = ${JSON.stringify(options.requiredPluginArtifacts ?? ["extensions/omo.js"])}\n`,
    )

    const packageDir = join(fakeRepoRoot, "packages", "omo-native")
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, "package.json"),
      `${JSON.stringify(
        { name: "omo-ai-payload-guard-fixture", version: "0.0.0", private: false, files: ["bin", "plugin"] },
        null,
        2,
      )}\n`,
      "utf8",
    )
    for (const relativePath of payloadPaths) {
      writeFixtureFile(
        packageDir,
        relativePath,
        contents[relativePath] ?? (relativePath === "plugin/package.json" ? '{"imports":{}}\n' : "// fixture\n"),
      )
      const mode = options.modes?.[relativePath]
      if (mode !== undefined) chmodSync(join(packageDir, relativePath), mode)
    }

    const result = spawnSync(
      options.runtime ?? process.execPath,
      [join(fakeRepoRoot, "script", "verify-omo-ai-payload.mjs"), ...(options.args ?? [])],
      {
        cwd: fakeRepoRoot,
        encoding: "utf8",
        timeout: guardTimeoutMs,
        // npm pack reads the user's npmrc and writes logs under the home (#13253): give it a scratch home, cache and
        // userconfig inside the fixture root. The packed file list does not depend on them.
        env: {
          ...process.env,
          HOME: join(fakeRepoRoot, "home"),
          USERPROFILE: join(fakeRepoRoot, "home"),
          npm_config_cache: join(fakeRepoRoot, "npm-cache"),
          npm_config_userconfig: join(fakeRepoRoot, "npmrc"),
          ...options.env,
        },
      },
    )
    return {
      exitCode: result.status ?? 1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    }
  } finally {
    rmSync(fakeRepoRoot, { recursive: true, force: true })
  }
}

function skillPaths(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `plugin/skills/fixture-skill-${index}/SKILL.md`)
}

describe("omo-ai payload verifier", () => {
  test("#given a payload missing only the agent toolkit SDK #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([
      ...PACKED_ARTIFACTS.filter((path) => path !== "plugin/runtime/agent-toolkit-sdk/sdk.js"),
      ...skillPaths(PACKED_SKILL_COUNT),
    ])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: plugin/runtime/agent-toolkit-sdk/sdk.js")
  })

  // bin/omo.js imports it for omo auth, sync, account and remote; it is a generated output (#9903), so a payload
  // packed from a checkout that skipped the build must fail here instead of shipping those commands broken.
  test("#given a payload missing only the generated service-auth module #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([
      ...PACKED_ARTIFACTS.filter((path) => path !== "bin/lib/service-auth.generated.js"),
      ...skillPaths(PACKED_SKILL_COUNT),
    ])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: bin/lib/service-auth.generated.js")
  })

  test("#given a payload missing only the device-account extension #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([
      ...PACKED_ARTIFACTS.filter((path) => path !== "plugin/extensions/omo-device-account.js"),
      ...skillPaths(PACKED_SKILL_COUNT),
    ])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: plugin/extensions/omo-device-account.js")
  })

  describe("#given the release payload gate (--release) for the signed keychain helper", () => {
    const complete = [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)]

    test("#when the helper is absent #then it fails naming bin/darwin/omo-keychain", () => {
      const run = runVerifierOnPayload(complete, {}, { args: ["--release"] })
      expect(run.output).toContain(`missing artifact: ${KEYCHAIN_HELPER}`)
      expect(run.exitCode).toBe(1)
    })

    test.skipIf(process.platform === "win32")(
      "#when the helper is packed without u+x #then it fails on the execute bit",
      () => {
        const run = runVerifierOnPayload(
          [...complete, KEYCHAIN_HELPER],
          {},
          { args: ["--release"], modes: { [KEYCHAIN_HELPER]: 0o644 } },
        )
        expect(run.output).toContain(`not executable (u+x): ${KEYCHAIN_HELPER}`)
        expect(run.exitCode).toBe(1)
      },
    )

    test.skipIf(process.platform === "win32")("#when the helper is packed with mode 0755 #then it passes", () => {
      const run = runVerifierOnPayload(
        [...complete, ...RELEASE_GENERATED_ARTIFACTS, KEYCHAIN_HELPER],
        {},
        { args: ["--release"], modes: { [KEYCHAIN_HELPER]: 0o755 } },
      )
      expect(run.output).not.toContain(KEYCHAIN_HELPER)
      expect(run.exitCode).toBe(0)
    })

    test("#when the PR lane verifies without --release #then the helper is not required", () => {
      const run = runVerifierOnPayload(complete)
      expect(run.output).not.toContain(KEYCHAIN_HELPER)
      expect(run.exitCode).toBe(0)
    })
  })

  describe("#given the release payload gate (--release) for untracked build outputs", () => {
    const complete = [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT), KEYCHAIN_HELPER]

    test.each(RELEASE_GENERATED_ARTIFACTS)("#when %s was not built #then it fails naming it", (artifact) => {
      const run = runVerifierOnPayload(
        [...new Set([...complete, ...RELEASE_GENERATED_ARTIFACTS])].filter((path) => path !== artifact),
        {},
        { args: ["--release"], modes: { [KEYCHAIN_HELPER]: 0o755 } },
      )
      expect(run.output).toContain(`missing artifact: ${artifact}`)
      expect(run.exitCode).toBe(1)
    })

    test("#when the PR lane verifies without --release #then they are not required", () => {
      const run = runVerifierOnPayload([...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)])
      expect(run.output).not.toContain("missing artifact:")
      expect(run.exitCode).toBe(0)
    })
  })

  // The release build preflight (#13192) packs before publish-platform builds the macOS keychain helper.
  test.each(LISTED_SHIPPED_LITERALS)(
    "#given a release payload without the listed generated output %s #when verified with --release-preflight #then it fails naming it",
    (missing) => {
      const run = runVerifierOnPayload(
        [...PACKED_ARTIFACTS, ...RELEASE_GENERATED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)].filter(
          (path) => path !== missing,
        ),
        {},
        { args: ["--release-preflight"] },
      )
      expect(run.exitCode).toBe(1)
      expect(run.output).toContain(`missing artifact: ${missing}`)
    },
  )

  describe("#given the plugin import map in a release payload", () => {
    const manifest = JSON.stringify({ imports: { "#omo-task-runtime": "./extensions/omo-task.js" } })
    const payload = [
      ...new Set([...PACKED_ARTIFACTS, ...RELEASE_GENERATED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)]),
    ]

    test("#when a sidecar it maps is not packed #then --release-preflight fails naming it", () => {
      const run = runVerifierOnPayload(payload, { "plugin/package.json": manifest }, { args: ["--release-preflight"] })
      expect(run.output).toContain("missing artifact: plugin/extensions/omo-task.js")
      expect(run.exitCode).toBe(1)
    })

    test("#when plugin/package.json itself is absent #then it fails with a missing-artifact line, not a stack trace", () => {
      const run = runVerifierOnPayload(
        payload.filter((path) => path !== "plugin/package.json"),
        {},
        { args: ["--release-preflight"] },
      )
      expect(run.output).toContain("missing artifact: plugin/package.json")
      expect(run.output).not.toContain("    at ")
      expect(run.exitCode).toBe(1)
    })

    test("#when every sidecar it maps is packed #then --release-preflight passes", () => {
      const run = runVerifierOnPayload(
        [...payload, "plugin/extensions/omo-task.js"],
        { "plugin/package.json": manifest },
        {
          args: ["--release-preflight"],
        },
      )
      expect(run.output).not.toContain("missing artifact:")
      expect(run.exitCode).toBe(0)
    })
  })

  describe("#given the installer's REQUIRED_PLUGIN_ARTIFACTS in a release payload", () => {
    const payload = [
      ...new Set([...PACKED_ARTIFACTS, ...RELEASE_GENERATED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)]),
    ]
    const required = ["extensions/omo.js", "extensions/omo-side-panel.js"]

    test("#when a sidecar loaded by path is not packed #then --release fails naming it", () => {
      const run = runVerifierOnPayload(
        [...payload, KEYCHAIN_HELPER],
        {},
        {
          args: ["--release"],
          modes: { [KEYCHAIN_HELPER]: 0o755 },
          requiredPluginArtifacts: required,
        },
      )
      expect(run.output).toContain("missing artifact: plugin/extensions/omo-side-panel.js")
      expect(run.exitCode).toBe(1)
    })

    // The workflows run the verifier with node (ci.yml, publish.yml), and node reads the list through the job's bun.
    test("#when started with node as the workflows do #then it reads the list through bun and passes a complete payload", () => {
      const run = runVerifierOnPayload(
        [...payload, "plugin/extensions/omo-side-panel.js"],
        {},
        {
          args: ["--release-preflight"],
          requiredPluginArtifacts: required,
          runtime: "node",
        },
      )
      expect(run.output).not.toContain("missing artifact:")
      expect(run.exitCode).toBe(0)
    })

    test("#when bun is not on PATH #then it fails naming bun, not with a stack trace", () => {
      const emptyPath = mkdtempSync(join(tmpdir(), "omo-no-bun-path-"))
      try {
        const node = Bun.which("node")
        if (node === null) throw new Error("node is required for this test")
        const run = runVerifierOnPayload(
          payload,
          {},
          {
            args: ["--release-preflight"],
            requiredPluginArtifacts: required,
            runtime: node,
            env: { PATH: emptyPath, Path: emptyPath },
          },
        )
        expect(run.output).toContain("needs bun")
        expect(run.output).not.toContain("    at ")
        expect(run.exitCode).toBe(1)
      } finally {
        rmSync(emptyPath, { recursive: true, force: true })
      }
    })
  })

  describe("#given a requirement list that is empty", () => {
    const payload = [
      ...new Set([
        ...PACKED_ARTIFACTS,
        ...RELEASE_GENERATED_ARTIFACTS,
        ...skillPaths(PACKED_SKILL_COUNT),
        KEYCHAIN_HELPER,
      ]),
    ]

    test("#when the requirements helper answers with no requirements #then --release fails instead of passing", () => {
      const run = runVerifierOnPayload(
        payload,
        {},
        {
          args: ["--release"],
          modes: { [KEYCHAIN_HELPER]: 0o755 },
          requirementsHelper: "console.log(JSON.stringify({ pluginOutputs: [], generated: [] }))\n",
        },
      )
      expect(run.output).toContain("the plugin requirement list is empty")
      expect(run.exitCode).toBe(1)
    })

    test("#when script/generated-bundles.json has no patterns #then --release fails", () => {
      const run = runVerifierOnPayload(
        payload,
        {},
        {
          args: ["--release"],
          modes: { [KEYCHAIN_HELPER]: 0o755 },
          generatedList: '{ "dialect": "ecmascript" }\n',
        },
      )
      expect(run.output).toContain("patterns")
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given the requirements helper fails", () => {
    const payload = [
      ...new Set([
        ...PACKED_ARTIFACTS,
        ...RELEASE_GENERATED_ARTIFACTS,
        ...skillPaths(PACKED_SKILL_COUNT),
        KEYCHAIN_HELPER,
      ]),
    ]
    const runWithHelper = (requirementsHelper: string) =>
      runVerifierOnPayload(
        payload,
        {},
        { args: ["--release"], modes: { [KEYCHAIN_HELPER]: 0o755 }, requirementsHelper },
      )
    const errorLines = (output: string) =>
      output.split("\n").filter((line) => line.includes("script/plugin-required-outputs.ts"))

    test("#when it prints output that is not JSON #then one line names the helper, with no stack", () => {
      const run = runWithHelper('console.log("not json at all")\n')
      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain("script/plugin-required-outputs.ts")
      expect(run.output).toContain("printed output that is not JSON")
      expect(run.output).not.toContain("    at ")
      expect(errorLines(run.output)).toHaveLength(1)
    })

    test('#when an entry of "generated" is malformed #then one line names that field, with no stack', () => {
      const run = runWithHelper(
        'console.log(JSON.stringify({ pluginOutputs: ["extensions/omo.js"], generated: [{ label: 7 }] }))\n',
      )
      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain("script/plugin-required-outputs.ts")
      expect(run.output).toContain('"generated"')
      expect(run.output).not.toContain("    at ")
      expect(errorLines(run.output)).toHaveLength(1)
    })

    test("#when a generated entry's source is not a regular expression #then one line names the helper and that label", () => {
      const run = runWithHelper(
        'console.log(JSON.stringify({ pluginOutputs: ["extensions/omo.js"], generated: [{ label: "bad-entry", source: "(" }] }))\n',
      )
      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain("script/plugin-required-outputs.ts")
      expect(run.output).toContain("bad-entry")
      expect(run.output).not.toContain("    at ")
      expect(errorLines(run.output)).toHaveLength(1)
    })

    test("#when it prints empty lists #then one line names the helper and the empty requirement list, with no stack", () => {
      const run = runWithHelper("console.log(JSON.stringify({ pluginOutputs: [], generated: [] }))\n")
      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain("script/plugin-required-outputs.ts")
      expect(run.output).toContain("the plugin requirement list is empty")
      expect(run.output).not.toContain("    at ")
      expect(errorLines(run.output)).toHaveLength(1)
    })

    // ".", "[^]" and "packages/" cannot match "" yet match every packed path; "^packages/omo-native/" matches every path
    // under a shipped root.
    test.each(["", ".*", ".", "[^]", "packages/", "^packages/omo-native/"])(
      "#when a generated entry's source %p matches every path #then one line names the helper and that label",
      (source) => {
        const helperOutput = JSON.stringify({
          pluginOutputs: ["extensions/omo.js"],
          generated: [{ label: "match-all-entry", source }],
        })
        const run = runWithHelper(`console.log(${JSON.stringify(helperOutput)})\n`)
        expect(run.exitCode).not.toBe(0)
        expect(run.output).toContain("script/plugin-required-outputs.ts")
        expect(run.output).toContain("match-all-entry")
        expect(run.output).not.toContain("    at ")
        expect(errorLines(run.output)).toHaveLength(1)
      },
    )

    test("#when it exits non-zero #then one line names the helper and only the first stderr line", () => {
      const run = runWithHelper(
        'console.error("first stderr line")\nconsole.error("    at somewhere (file.ts:1:1)")\nprocess.exit(3)\n',
      )
      expect(run.exitCode).not.toBe(0)
      expect(run.output).toContain("script/plugin-required-outputs.ts")
      expect(run.output).toContain("first stderr line")
      expect(run.output).not.toContain("    at ")
      expect(errorLines(run.output)).toHaveLength(1)
    })
  })

  describe("#given a generated output the payload lacks, whose source still matches other packed paths", () => {
    test("#when --release runs #then it fails naming that output", () => {
      const helperOutput = JSON.stringify({
        pluginOutputs: ["extensions/omo.js"],
        generated: [
          { label: "packages/omo-native/bin/lib/never-built.generated.js", source: "^packages\\/omo-native\\/bin\\/" },
        ],
      })
      const run = runVerifierOnPayload(
        [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT), KEYCHAIN_HELPER],
        {},
        {
          args: ["--release"],
          modes: { [KEYCHAIN_HELPER]: 0o755 },
          requirementsHelper: `console.log(${JSON.stringify(helperOutput)})\n`,
        },
      )
      expect(run.output).toContain("missing artifact: bin/lib/never-built.generated.js")
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given the release preflight gate (--release-preflight)", () => {
    const complete = [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT), ...RELEASE_GENERATED_ARTIFACTS]

    test("#when bin/lib/service-auth.generated.js was not built and no helper is staged #then it fails naming the module", () => {
      const run = runVerifierOnPayload(
        complete.filter((path) => path !== "bin/lib/service-auth.generated.js"),
        {},
        { args: ["--release-preflight"] },
      )
      expect(run.output).toContain("missing artifact: bin/lib/service-auth.generated.js")
      expect(run.output).not.toContain(KEYCHAIN_HELPER)
      expect(run.exitCode).toBe(1)
    })

    test("#when every generated module is packed and no helper is staged #then it passes", () => {
      const run = runVerifierOnPayload(complete, {}, { args: ["--release-preflight"] })
      expect(run.output).not.toContain("missing artifact:")
      expect(run.exitCode).toBe(0)
    })
  })

  test("#given a payload missing only the omo daemon task-config runtime #when verified #then it fails naming that artifact", () => {
    const run = runVerifierOnPayload([
      ...PACKED_ARTIFACTS.filter((path) => path !== "plugin/runtime/task-config/index.js"),
      ...skillPaths(PACKED_SKILL_COUNT),
    ])
    expect(run.exitCode).toBe(1)
    expect(run.output).toContain("missing artifact: plugin/runtime/task-config/index.js")
  })

  describe("#given a packed payload whose only gap is the dag eval sdk", () => {
    describe("#when the verifier runs", () => {
      test("#then it fails naming plugin/runtime/dag/sdk.js as a missing artifact", () => {
        // given
        const payload = [
          ...PACKED_ARTIFACTS.filter((path) => path !== "plugin/runtime/dag/sdk.js"),
          ...skillPaths(PACKED_SKILL_COUNT),
        ]

        // when
        const run = runVerifierOnPayload(payload)

        // then
        expect(run.output).toContain("missing artifact: plugin/runtime/dag/sdk.js")
        expect(run.exitCode).toBe(1)
      })
    })
  })

  describe("#given the 5.1.1 layout: the category-coverage bundle reads a sibling asset only extensions/ ships", () => {
    test("#then it fails naming the unpacked sibling asset", () => {
      const payload = [
        ...PACKED_ARTIFACTS.filter((path) => path !== CATEGORY_COVERAGE_ASSET),
        "plugin/extensions/assets.generated.json",
        ...skillPaths(PACKED_SKILL_COUNT),
      ]

      const run = runVerifierOnPayload(payload, { [CATEGORY_COVERAGE_BUNDLE]: BUNDLED_SIBLING_READ })

      expect(run.output).toContain(
        `missing sibling asset: ${CATEGORY_COVERAGE_BUNDLE} reads ${CATEGORY_COVERAGE_ASSET}, which is not packed`,
      )
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given any packed bundle that reads a sibling file the payload does not ship", () => {
    test("#then the sibling-asset rule fails on its own, beyond the pinned artifact list", () => {
      const bundle = "plugin/runtime/dag/library.js"
      const payload = [...PACKED_ARTIFACTS, bundle, ...skillPaths(PACKED_SKILL_COUNT)]

      const run = runVerifierOnPayload(payload, {
        [bundle]: MINIFIED_SIBLING_READ.replace("assets.generated.json", "library-data.json"),
      })

      expect(run.output).not.toContain("missing artifact:")
      expect(run.output).toContain(
        `missing sibling asset: ${bundle} reads plugin/runtime/dag/library-data.json, which is not packed`,
      )
      expect(run.exitCode).toBe(1)
    })
  })

  describe("#given every sibling-asset reader ships its asset beside it", () => {
    test("#then both the bundled and the minified read shapes pass", () => {
      const payload = [
        ...PACKED_ARTIFACTS,
        "plugin/extensions/omo-computer-use.js",
        "plugin/extensions/assets.generated.json",
        ...skillPaths(PACKED_SKILL_COUNT),
      ]

      const run = runVerifierOnPayload(payload, {
        [CATEGORY_COVERAGE_BUNDLE]: BUNDLED_SIBLING_READ,
        "plugin/extensions/omo-computer-use.js": MINIFIED_SIBLING_READ,
      })

      expect(run.output).not.toContain("missing sibling asset:")
      expect(run.exitCode).toBe(0)
    })
  })

  describe("#given a packed payload carrying every pinned artifact", () => {
    describe("#when the verifier runs", () => {
      test("#then it passes with no missing-artifact error", () => {
        // given
        const payload = [...PACKED_ARTIFACTS, ...skillPaths(PACKED_SKILL_COUNT)]

        // when
        const run = runVerifierOnPayload(payload)

        // then
        expect(run.output).not.toContain("missing artifact:")
        expect(run.exitCode).toBe(0)
      })
    })
  })
})
