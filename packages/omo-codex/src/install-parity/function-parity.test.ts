import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveCodexInstallerBinDir as tsResolveBinDir } from "../../../omo-opencode/src/cli/install-codex/codex-installer-bin-dir"
import {
  resolvePluginSource as tsResolvePluginSource,
  validatePathSegment as tsValidatePathSegment,
} from "../../../omo-opencode/src/cli/install-codex/codex-marketplace"
import { installedMarketplaceRoot as tsInstalledMarketplaceRoot } from "../../../omo-opencode/src/cli/install-codex/codex-marketplace-snapshot"
import { repairProjectLocalCodexConfigText as tsRepairProjectLocalConfig } from "../../../omo-opencode/src/cli/install-codex/codex-project-local-cleanup"
import { resolveLazyCodexPluginVersion as tsResolveLazyCodexPluginVersion } from "../../../omo-opencode/src/cli/install-codex/lazycodex-version-stamp"
import { runMjsScript, type JsonValue } from "./mjs-runner"

const scriptInstallUrl = pathToFileURL(`${import.meta.dir}/../../scripts/install/`).href
const mjsFunctionScript = `
import { Buffer } from "node:buffer";
const input = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
const module = await import(${JSON.stringify(scriptInstallUrl)} + input.modulePath);
try {
  let result;
  if (input.operation === "resolveLazyCodexPluginVersion") {
    result = module.resolveLazyCodexPluginVersion(input.args);
  } else if (input.operation === "resolvePluginSource") {
    result = module.resolvePluginSource(input.args.marketplaceRoot, input.args.plugin, input.args.options);
  } else if (input.operation === "validatePathSegment") {
    module.validatePathSegment(input.args.value, input.args.label);
    result = { ok: true };
  } else if (input.operation === "installedMarketplaceRoot") {
    result = module.installedMarketplaceRoot(input.args.codexHome, input.args.marketplaceName);
  } else if (input.operation === "resolveCodexInstallerBinDir") {
    result = module.resolveCodexInstallerBinDir(input.args);
  } else if (input.operation === "repairProjectLocalCodexConfigText") {
    result = module.repairProjectLocalCodexConfigText(input.args.config);
  } else {
    throw new Error("unknown operation " + input.operation);
  }
  console.log(JSON.stringify({ ok: true, result }));
} catch (error) {
  if (!(error instanceof Error)) throw error;
  console.log(JSON.stringify({ ok: false, message: error.message }));
}
`

describe("installer pure function TS to mjs parity", () => {
  it("#given lazycodex identity inputs #when resolving plugin versions #then outputs match", async () => {
    // given
    const cases = [
      {
        manifestVersion: "0.1.0",
        marketplaceName: "sisyphuslabs",
        pluginName: "omo",
        distributionManifest: { name: "lazycodex-ai", version: "4.9.1" },
      },
      { manifestVersion: "0.2.0", marketplaceName: "debug", pluginName: "omo" },
      { marketplaceName: "debug", pluginName: "alpha" },
    ] as const

    // when
    const outputs = await Promise.all(cases.map((input) => runMjsOperation("lazycodex-version-stamp.mjs", "resolveLazyCodexPluginVersion", input)))

    // then
    expect(outputs.map((output) => requireOk(output))).toEqual(cases.map((input) => tsResolveLazyCodexPluginVersion(input)))
  })

  it("#given marketplace path inputs #when resolving and validating #then outputs match", async () => {
    // given
    const marketplaceRoot = join("/tmp", "marketplace")
    const plugin = { name: "omo", source: { source: "local", path: "./plugins/omo" } } as const

    // when
    const sourceOutput = await runMjsOperation("marketplace.mjs", "resolvePluginSource", {
      marketplaceRoot,
      plugin,
      options: { pathOverride: "./override/omo" },
    })
    const validOutput = await runMjsOperation("marketplace.mjs", "validatePathSegment", {
      value: "sisyphuslabs",
      label: "marketplace name",
    })
    const invalidOutput = await runMjsOperation("marketplace.mjs", "validatePathSegment", {
      value: "../bad",
      label: "marketplace name",
    })

    // then
    expect(requireOk(sourceOutput)).toBe(tsResolvePluginSource(marketplaceRoot, plugin, { pathOverride: "./override/omo" }))
    expect(validOutput).toEqual({ ok: true, result: { ok: true } })
    expect(invalidOutput).toEqual(errorResultFrom(() => tsValidatePathSegment("../bad", "marketplace name")))
  })

  it("#given cache-adjacent installer inputs #when resolving paths #then outputs match", async () => {
    // given
    const codexHome = join("/tmp", "codex-home")
    const homeDir = join("/tmp", "home")
    const binArgs = { codexHome, homeDir, env: { CODEX_LOCAL_BIN_DIR: "" } }

    // when
    const snapshotOutput = await runMjsOperation("snapshot.mjs", "installedMarketplaceRoot", {
      codexHome,
      marketplaceName: "sisyphuslabs",
    })
    const binOutput = await runMjsOperation("bin-dir.mjs", "resolveCodexInstallerBinDir", binArgs)

    // then
    expect(requireOk(snapshotOutput)).toBe(tsInstalledMarketplaceRoot(codexHome, "sisyphuslabs"))
    expect(requireOk(binOutput)).toBe(tsResolveBinDir(binArgs))
  })

  it("#given project-local config text #when repairing conflict keys #then outputs match", async () => {
    // given
    const config = [
      "[features.multi_agent_v2]",
      "enabled = true",
      "",
      "[agents]",
      "max_threads = 10",
      "max_depth = 4",
      "",
    ].join("\n")

    // when
    const output = await runMjsOperation("project-local-cleanup.mjs", "repairProjectLocalCodexConfigText", { config })

    // then
    expect(requireOk(output)).toEqual(tsRepairProjectLocalConfig(config))
  })
})

type OperationResult = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly message: string }

async function runMjsOperation(modulePath: string, operation: string, args: JsonValue): Promise<OperationResult> {
  const output = await runMjsScript(mjsFunctionScript, { modulePath, operation, args })
  return parseOperationResult(output)
}

function parseOperationResult(value: unknown): OperationResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new Error("mjs parity result must include ok boolean")
  }
  if (value.ok) return { ok: true, result: value.result }
  if (typeof value.message !== "string") {
    throw new Error("mjs parity error result must include message")
  }
  return { ok: false, message: value.message }
}

function errorResultFrom(run: () => void): OperationResult {
  try {
    run()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { ok: false, message: error.message }
  }
  return { ok: true, result: { ok: true } }
}

function requireOk(result: OperationResult): unknown {
  if (!result.ok) throw new Error(`expected mjs operation to pass: ${result.message}`)
  return result.result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
