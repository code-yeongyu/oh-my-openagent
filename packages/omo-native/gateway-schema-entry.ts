/**
 * The gateway-schema runtime `omo gateway` and `omo doctor` import from the staged payload
 * (`plugin/runtime/gateway-schema/index.js`, bundled by script/build-omo-native.ts). The launcher
 * is plain JS and cannot load TypeScript sources, so this bundle is how it resolves and validates
 * the `gateway` section through the one package that owns it (omo-config-core), instead of a copy
 * of the file lookup, the JSONC parse or the rules.
 */

import { loadOmoConfig, OmoGatewayConfigSchema, readUserGatewaySection, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

export type GatewayConfigValidation = { ok: true } | { ok: false; errors: string[] }

export type GatewayConfigResolution = {
  // The user config file the section is read from (~/.omo/omo.jsonc, else ~/.omo/omo.json).
  readonly userPath: string
  readonly section:
    | { readonly present: false }
    | { readonly present: true; readonly value: unknown; readonly validation: GatewayConfigValidation }
  // Gateway placements the loader dropped: project layers, profiles, non-native harness blocks.
  readonly ignored: readonly { readonly path: string; readonly placements: readonly string[] }[]
}

/** Formats a zod issue path as `gateway.scopes[0].surfaces[0].platform`. */
function formatPath(path: readonly (string | number | symbol)[]): string {
  let formatted = "gateway"
  for (const segment of path) {
    if (typeof segment === "number") formatted += `[${segment}]`
    else formatted += `.${String(segment)}`
  }
  return formatted
}

export function validateGatewayConfig(gateway: unknown): GatewayConfigValidation {
  const result = OmoGatewayConfigSchema.safeParse(gateway)
  if (result.success) return { ok: true }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
  }
}

export function resolveGatewayConfig(input: { readonly cwd: string; readonly env: OmoConfigEnv }): GatewayConfigResolution {
  const user = readUserGatewaySection({ env: input.env })
  const ignored = loadOmoConfig({ cwd: input.cwd, env: input.env })
    .diagnostics.filter((diagnostic) => diagnostic.kind === "ignored-keys")
    .map((diagnostic) => ({ path: diagnostic.path, placements: diagnostic.issuePaths ?? [] }))
  return {
    userPath: user.path,
    section: user.present
      ? { present: true, value: user.value, validation: validateGatewayConfig(user.value) }
      : { present: false },
    ignored,
  }
}
