import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import providerMap from "../bin/lib/provider-map.json"
import omoNativeManifest from "../package.json"

const senpiEntryPath = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))
const senpiPackageRoot = dirname(dirname(senpiEntryPath))
const senpiManifest = JSON.parse(
  await readFile(join(senpiPackageRoot, "package.json"), "utf8"),
) as { version: string }
const providerRegistryUrl = pathToFileURL(
  join(
    senpiPackageRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "dist",
    "providers",
    "all.js",
  ),
).href
const { builtinProviders } = await import(providerRegistryUrl) as {
  builtinProviders(): Array<{ id: string }>
}

const EXCLUDED_BUILTIN_PROVIDER_IDS = new Set(["opencode", "opencode-go"])

test("#given the installed Senpi pin #when builtin providers are derived #then the provider map is exact", () => {
  expect(senpiManifest.version).toBe(omoNativeManifest.dependencies["@code-yeongyu/senpi"])

  const expectedProviderIds = builtinProviders()
    .map(({ id }) => id)
    .filter((id) => !EXCLUDED_BUILTIN_PROVIDER_IDS.has(id))
    .sort()

  expect(providerMap.builtinProviderIds).toEqual(expectedProviderIds)
})
