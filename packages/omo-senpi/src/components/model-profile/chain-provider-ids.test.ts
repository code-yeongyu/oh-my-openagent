/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { CATEGORY_FALLBACK_CHAINS } from "../../../../senpi-task/src/category/fallback-chains"
import { BUILTIN_MODEL_PROFILES } from "./builtin-profiles"

// Same registry as packages/omo-native/test/provider-map-registry.test.ts: the `@earendil-works/pi-ai`
// the pinned senpi itself resolves (bundled inside it or installed beside it), not a checked-in
// snapshot that can drift from the pin.
const senpiEntryPath = fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))
const senpiPackageRoot = realpathSync(dirname(dirname(senpiEntryPath)))
const providerRegistryUrl = pathToFileURL(
  Bun.resolveSync("@earendil-works/pi-ai/providers/all", senpiPackageRoot),
).href
const { builtinProviders } = (await import(providerRegistryUrl)) as {
  builtinProviders(): Array<{ id: string }>
}

/**
 * Native builtin-profile and senpi-task category chains may name these ids even though they are
 * not in `builtinProviders()`. A new unknown id fails the test below unless it is added here
 * with a reason. OpenCode's own tables are not shared with these arrays; each keep is for a
 * leftover OpenCode-id key or a senpi extension lane.
 */
const CHAIN_PROVIDER_ID_ALLOWLIST: Readonly<Record<string, string>> = {
  // senpi Claude Pro/Max extension lane; not a pi-ai builtin.
  "anthropic-subscription": "senpi Claude subscription extension",
  // OpenCode/models.dev Anthropic API-key id. setup maps it to `anthropic`; Claude rungs keep it
  // so a leftover key still matches.
  "anthropic-api": "OpenCode anthropic API-key alias",
  // OpenCode/models.dev Kimi Code id. senpi-task category chains carry both `kimi-coding` (engine)
  // and this alias; builtin profiles copy that pair.
  "kimi-for-coding": "OpenCode kimi alias kept next to engine kimi-coding",
  // OpenCode Alibaba Bailian coding-plan id. Engine has no bailian builtin; kept on the quick
  // qwen rung so a leftover OpenCode key still matches.
  "bailian-coding-plan": "OpenCode Bailian coding-plan alias",
  // OpenCode CN Alibaba token-plan id. Engine CN Qwen is `qwen-token-plan-cn`; kept on
  // unspecified-low so a leftover OpenCode key still matches.
  "alibaba-token-plan-cn": "OpenCode CN Alibaba token-plan alias",
}

function chainProviderIds(): readonly string[] {
  const ids = new Set<string>()
  for (const profile of Object.values(BUILTIN_MODEL_PROFILES)) {
    for (const rung of profile.models) {
      for (const provider of rung.providers) ids.add(provider)
    }
  }
  for (const chain of Object.values(CATEGORY_FALLBACK_CHAINS)) {
    for (const rung of chain) {
      for (const provider of rung.providers) ids.add(provider)
    }
  }
  return [...ids].sort()
}

describe("native chain provider ids", () => {
  test("#given builtin profiles and senpi-task category chains #when each provider id is checked against the pinned engine registry #then every id is a builtinProviders() id or an allow-listed alias", () => {
    const engineIds = new Set(builtinProviders().map(({ id }) => id))
    const unknown = chainProviderIds().filter((id) => !engineIds.has(id) && !Object.hasOwn(CHAIN_PROVIDER_ID_ALLOWLIST, id))
    expect(unknown).toEqual([])
  })

  test("#given the allow-list #when compared with the engine registry #then no allow-listed id is a builtin, so the list cannot hide drift", () => {
    const engineIds = new Set(builtinProviders().map(({ id }) => id))
    const overlapping = Object.keys(CHAIN_PROVIDER_ID_ALLOWLIST).filter((id) => engineIds.has(id))
    expect(overlapping).toEqual([])
  })
})
