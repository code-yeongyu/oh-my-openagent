#!/usr/bin/env bun
import { runSenpiInstaller, runSenpiUninstaller } from "./install-senpi"

type JsonResult =
  | Awaited<ReturnType<typeof runSenpiInstaller>>
  | Awaited<ReturnType<typeof runSenpiUninstaller>>
  | { readonly ok: false; readonly error: string }

async function main(argv: readonly string[]): Promise<number> {
  const action = argv[2]
  try {
    if (action === "install") {
      printJson(await runSenpiInstaller())
      return 0
    }
    if (action === "uninstall") {
      printJson(await runSenpiUninstaller())
      return 0
    }
    throw new Error("Expected positional action install|uninstall")
  } catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) })
    return 1
  }
}

function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

process.exit(await main(process.argv))
