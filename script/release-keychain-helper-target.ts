// script/release-keychain-helper-target.ts
// Where the signed keychain helper (#11262) enters every darwin release output. The release
// workflows place the signed universal helper at KEYCHAIN_HELPER_SOURCE (publish-platform.yml
// "Stage keychain helper", publish.yml publish-main), which is also its path inside the omo-ai
// tarball. build-omo-binary embeds it for darwin targets at KEYCHAIN_HELPER_PAYLOAD, the payload
// root, so the provisioned runtime finds it at execDir/omo-keychain: the one runtime layout the
// desktop also uses (#11262 RULING-74).

import { chmodSync, copyFileSync, mkdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const KEYCHAIN_HELPER_PAYLOAD = "omo-keychain"
export const KEYCHAIN_HELPER_SOURCE = "packages/omo-native/bin/darwin/omo-keychain"
export const KEYCHAIN_HELPER_RELEASE_ASSET = "omo-keychain-darwin-universal"

export function keychainHelperPayload(target: string): string | null {
  return target.startsWith("darwin-") ? KEYCHAIN_HELPER_PAYLOAD : null
}

export function stageKeychainHelper(
  target: string,
  stageDir: string,
  sourceRoot: string = resolve(dirname(import.meta.dir)),
): string | null {
  const payload = keychainHelperPayload(target)
  if (payload === null) return null
  const source = join(sourceRoot, KEYCHAIN_HELPER_SOURCE)
  let isFile = false
  try {
    isFile = statSync(source).isFile()
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
  }
  if (!isFile) {
    throw new Error(
      `missing required keychain helper for ${target}: ${source} (build it with bun packages/omo-native/keychain-helper/build.ts --out ${KEYCHAIN_HELPER_SOURCE})`,
    )
  }
  const destination = join(stageDir, payload)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
  chmodSync(destination, 0o755)
  return payload
}
