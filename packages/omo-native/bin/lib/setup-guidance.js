/**
 * What to tell the user about credentials setup found but could not copy.
 *
 * OAuth credentials are provider-bound tokens, so they are never copied; the user has to sign in
 * again. That sign-in lives in the interactive session (`/login <provider>`), NOT in `omo auth`,
 * which only prints or checks credentials that already exist.
 */

function oauthLoginTarget(provider, providerMap) {
  const mapped = providerMap.oauthLogins[provider]
  if (mapped) return mapped
  return providerMap.oauthProviderIds.includes(provider) ? provider : undefined
}

// `login`: sign in with `/login <target>`; `signed-in`: a re-run after the user followed the advice
// must not tell them to sign in a second time; `unsupported`: omo has no provider for it.
function oauthLogin(provider, providerMap, existing) {
  const target = oauthLoginTarget(provider, providerMap)
  if (!target) return { provider, state: "unsupported" }
  return { provider, target, state: existing[target]?.type === "oauth" ? "signed-in" : "login" }
}

/**
 * `logins`: one entry per skipped OAuth provider. `unmapped`: API-key provider ids no omo provider
 * serves; the next step for them is to define the provider in the engine's models.json.
 */
export function credentialGuidance(result, providerMap, existing = {}) {
  return {
    logins: result.skippedOauth.map((provider) => oauthLogin(provider, providerMap, existing)),
    unmapped: result.skippedUnmapped,
  }
}
