// The test preload (test-hermetic-home.ts) replaces Bun.secrets with an in-memory stand-in marked with this symbol. Every
// path that would reach the real OS store or the signed keychain helper reads the mark from here.
export const INJECTED_SECRETS = Symbol.for("omo.test.injectedSecrets")

export const isInjectedSecrets = (api: unknown): boolean =>
  typeof api === "object" &&
  api !== null &&
  (api as { readonly [INJECTED_SECRETS]?: unknown })[INJECTED_SECRETS] === true

/** Whether this process runs under the test preload. */
export const underTestPreload = (): boolean => typeof Bun !== "undefined" && isInjectedSecrets(Bun.secrets)

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * The environment mark of a test run, for the processes a test starts (custody review of 09d971691e, L5): the test
 * preload sets it in `process.env`, so a child the test starts with that environment carries it, and a test that builds
 * a child's environment passes it. A child spawned with no `env` gets the runner's start-up environment instead (Bun's
 * default), which has neither the mark nor the hermetic HOME: a test that starts the omo command passes its environment.
 */
export const TEST_RUN_MARK = "OMO_TEST_RUN"

/**
 * Whether this process is a test run: under the preload, run by `bun test` (whose main module is the test file, wherever
 * tests are started; review 6067671766 L2), or started by a test that passed the mark.
 */
export const underTestRun = (
  main: string = typeof Bun === "undefined" ? "" : Bun.main,
  secrets: unknown = typeof Bun === "undefined" ? undefined : Bun.secrets,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean => isInjectedSecrets(secrets) || TEST_FILE.test(main) || env[TEST_RUN_MARK] === "1"

/**
 * The repository's one guard on the signed keychain helper (security owner's order on the 2026-11-26 incident): in a
 * test run, a port that would resolve, verify, pin or spawn the real helper is refused, by name.
 */
export class KeychainHelperUnderTestPreload extends Error {
  constructor(readonly port: string) {
    super(
      `${port} reached for the signed keychain helper under the test preload; a test injects a fake spawner (resolveHelperAccess's spawn option) instead`,
    )
  }
}
