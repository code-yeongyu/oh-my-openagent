// The test preload (test-hermetic-home.ts) replaces Bun.secrets with an in-memory stand-in marked with this symbol. Every
// path that would reach the real OS store or the signed keychain helper reads the mark from here.
export const INJECTED_SECRETS = Symbol.for("omo.test.injectedSecrets")

export const isInjectedSecrets = (api: unknown): boolean =>
  typeof api === "object" &&
  api !== null &&
  (api as { readonly [INJECTED_SECRETS]?: unknown })[INJECTED_SECRETS] === true

/** Whether this process runs under the test preload. */
export const underTestPreload = (): boolean => typeof Bun !== "undefined" && isInjectedSecrets(Bun.secrets)

/**
 * The repository's one guard on the signed keychain helper (security owner's order on the 2026-11-26 incident): under
 * the test preload, a port that would resolve, verify, pin or spawn the real helper is refused, by name.
 */
export class KeychainHelperUnderTestPreload extends Error {
  constructor(readonly port: string) {
    super(
      `${port} reached for the signed keychain helper under the test preload; a test injects a fake spawner (resolveHelperAccess's spawn option) instead`,
    )
  }
}
