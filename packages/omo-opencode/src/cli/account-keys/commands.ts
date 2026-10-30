import type { Command } from "commander"
import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import { initializeDeviceKeyring, loadDeviceKeyring } from "./keyring"
import { createOsKeyStore, type KeyStore } from "./keystore"

export const ACCOUNT_KEYS_RECORD_NAME = "device-keys-v1"

export interface AccountKeysDependencies {
  readonly store: () => KeyStore
  readonly output: (line: string) => void
}

const defaultDependencies: AccountKeysDependencies = {
  store: () => createOsKeyStore(ACCOUNT_KEYS_RECORD_NAME),
  output: line => console.log(line),
}

function describe(keyring: DeviceKeyring): string {
  const { signing, sealing } = keyring.publicKeys()
  return JSON.stringify({ device: keyring.principal().id, signing, sealing })
}

async function report(dependencies: AccountKeysDependencies, action: (store: KeyStore) => Promise<string>): Promise<void> {
  try {
    dependencies.output(await action(dependencies.store()))
  } catch (error) {
    const message = error instanceof Error ? error.message : "omo account keys: the operation failed"
    console.error(message)
    process.exitCode = 1
  }
}

export function configureAccountKeysCommands(program: Command, dependencies: AccountKeysDependencies = defaultDependencies): void {
  const keys = program.command("account").description("OmO account and device identity")
    .command("keys").description("Device sync keys kept in the OS keystore")
  keys.command("init")
    .description("Create this device's sync keys (keeps existing keys)")
    .action(() => report(dependencies, async store => describe(await initializeDeviceKeyring(store))))
  keys.command("status")
    .description("Show this device's public sync keys")
    .action(() =>
      report(dependencies, async store => {
        const keyring = await loadDeviceKeyring(store)
        if (!keyring) throw new Error("omo account keys: no device keys yet. Run `omo account keys init` first.")
        return describe(keyring)
      }),
    )
}

export async function runAccountKeysCommand(args: readonly string[]): Promise<void> {
  const { Command: Program } = await import("commander")
  const program = new Program("omo")
  configureAccountKeysCommands(program)
  await program.parseAsync([...args], { from: "user" })
}
