#!/usr/bin/env bun

import * as path from "node:path"
import { createAliasPlatformPackage } from "./alias-platform-package"

function getArg(flag: string): string | null {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null

  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) {
    return null
  }

  return value
}

const sourceDir = getArg("--source")
const outDir = getArg("--out")

if (!sourceDir || !outDir) {
  throw new Error("Missing required --source or --out argument")
}

createAliasPlatformPackage(path.resolve(sourceDir), path.resolve(outDir))
