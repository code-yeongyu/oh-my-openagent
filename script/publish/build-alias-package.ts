#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import * as path from "node:path"
import { createAliasMainPackage } from "./alias-main-package"

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null

  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    return null
  }

  return value
}

const outDir = getArg("--out")
if (!outDir) {
  throw new Error("Missing required --out argument")
}

const version = getArg("--version")

const sourceRoot =
  getArg("--source") ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
createAliasMainPackage(sourceRoot, path.resolve(outDir), {
  version: version ?? undefined,
})
