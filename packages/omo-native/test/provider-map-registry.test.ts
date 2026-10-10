import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { engineDependencyDir } from "../bin/lib/engine-dependency.js"
import providerMap from "../bin/lib/provider-map.json"
import omoNativeManifest from "../package.json"

const senpiEntryPath = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))
const senpiPackageRoot = dirname(dirname(senpiEntryPath))
const senpiManifest = JSON.parse(
  await readFile(join(senpiPackageRoot, "package.json"), "utf8"),
) as { version: string }
const piAiRoot = engineDependencyDir(senpiPackageRoot, "@earendil-works/pi-ai")
if (piAiRoot === undefined) throw new Error(`@earendil-works/pi-ai is not resolvable from ${senpiPackageRoot}`)
const providerRegistryUrl = pathToFileURL(join(piAiRoot, "dist", "providers", "all.js")).href
const { builtinProviders } = await import(providerRegistryUrl) as {
  builtinProviders(): Array<{ id: string, auth?: { oauth?: unknown } }>
}

const { ANTHROPIC_SUBSCRIPTION_PROVIDER_ID } = await import(pathToFileURL(join(
  senpiPackageRoot, "dist", "core", "extensions", "builtin", "anthropic-subscription", "account-management.js",
)).href) as { ANTHROPIC_SUBSCRIPTION_PROVIDER_ID: string }

test("#given the installed Senpi pin #when builtin providers are derived #then the provider map is exact", () => {
  expect(senpiManifest.version).toBe(omoNativeManifest.dependencies["@code-yeongyu/senpi"])

  const expectedProviderIds = builtinProviders().map(({ id }) => id).sort()

  expect(providerMap.builtinProviderIds).toEqual(expectedProviderIds)
})

test("#given the installed Senpi pin #when oauth providers are derived #then the login map is exact", () => {
  const expectedOauthIds = builtinProviders()
    .filter((provider) => provider.auth?.oauth !== undefined)
    .map(({ id }) => id)
    .sort()

  expect(providerMap.oauthProviderIds).toEqual(expectedOauthIds)

  // Every /login target the map names must be a provider the engine can actually sign in to:
  // a builtin oauth provider, or an extension-registered one that ships with the engine.
  // The id is read from the engine so a rename there fails here instead of shipping a dead /login hint.
  const extensionOauthIds = new Set([ANTHROPIC_SUBSCRIPTION_PROVIDER_ID])
  for (const target of Object.values(providerMap.oauthLogins)) {
    expect(expectedOauthIds.includes(target) || extensionOauthIds.has(target)).toBe(true)
  }
})
