import { lstat, readFile } from "node:fs/promises"
import { join } from "node:path"

import { generatedMcpSchema, type GeneratedMcp, StandaloneParityInputError } from "./contracts"
import { copyTree, ensureRegularSourceRoot } from "./safe-files"

const OPENVIKING_PACKAGE = "@openviking/opencode-plugin"
const OPENVIKING_VERSION = "0.2.4"

export interface OpenVikingPackageInput {
  readonly pluginRoot?: string
  readonly credentialPath?: string
  readonly configPath?: string
}

export async function packageOpenVikingProxy(
  input: OpenVikingPackageInput,
  stagingRoot: string,
): Promise<GeneratedMcp | undefined> {
  if (input.pluginRoot === undefined) return undefined
  const pluginRoot = await ensureRegularSourceRoot(input.pluginRoot)
  const manifest = parsePackageManifest(await readFile(join(pluginRoot, "package.json"), "utf8"))
  if (manifest.name !== OPENVIKING_PACKAGE) {
    throw new StandaloneParityInputError(`OpenViking package name must be ${OPENVIKING_PACKAGE}`)
  }
  if (manifest.version !== OPENVIKING_VERSION) {
    throw new StandaloneParityInputError(`OpenViking package version must be ${OPENVIKING_VERSION}`)
  }
  const proxyPath = join(pluginRoot, "servers", "mcp-proxy.mjs")
  const proxyStat = await lstat(proxyPath)
  if (!proxyStat.isFile() || proxyStat.isSymbolicLink()) {
    throw new StandaloneParityInputError("OpenViking MCP proxy must be a regular file")
  }
  await copyTree(pluginRoot, join(stagingRoot, "openviking-plugin"))
  const env: Record<string, string> = {}
  if (input.credentialPath !== undefined) env["OPENVIKING_CLI_CONFIG_FILE"] = input.credentialPath
  if (input.configPath !== undefined) env["OPENVIKING_PLUGIN_CONFIG"] = input.configPath
  return generatedMcpSchema.parse({
    name: "openviking",
    declaration: {
      type: "stdio",
      command: "node",
      args: ["${OMO_STANDALONE_PARITY_ROOT}/openviking-plugin/servers/mcp-proxy.mjs"],
      env,
    },
  })
}

function parsePackageManifest(source: string): { readonly name: string; readonly version: string } {
  const value: unknown = JSON.parse(source)
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new StandaloneParityInputError("OpenViking package manifest must be an object")
  }
  const name = Reflect.get(value, "name")
  const version = Reflect.get(value, "version")
  if (typeof name !== "string" || typeof version !== "string") {
    throw new StandaloneParityInputError("OpenViking package manifest requires name and version")
  }
  return { name, version }
}
