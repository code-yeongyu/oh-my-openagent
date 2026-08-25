#!/usr/bin/env node

import { createFileScanner } from "./prompt_contract_scan.mjs"
import { findTypeScript, parseArgs } from "./prompt_contract_runtime.mjs"

const args = parseArgs(process.argv)
const typescript = findTypeScript(args.root)
const scanFile = createFileScanner(typescript, args.root)
const candidates = args.files.flatMap((relative) => scanFile(relative))

process.stdout.write(JSON.stringify({ parser: `typescript-${typescript.version}`, candidates }))
