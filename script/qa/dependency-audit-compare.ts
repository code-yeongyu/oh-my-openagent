#!/usr/bin/env bun
import { parseArgs } from "node:util"
import { z } from "zod"
import { compareDirectories } from "./dependency-audit/comparison"

if (import.meta.main) {
  try {
    const options = z.object({ baseline: z.string().min(1), post: z.string().min(1), gate: z.enum(["p0", "p1"]) }).parse(parseArgs({
      args: process.argv.slice(2), strict: true, allowPositionals: false,
      options: { baseline: { type: "string" }, post: { type: "string" }, gate: { type: "string" } },
    }).values)
    const result = await compareDirectories(options.baseline, options.post, options.gate)
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.pass ? 0 : 1
  } catch (error) {
    if (!(error instanceof Error)) throw error
    console.error(JSON.stringify({ error: error.name, message: error.message }))
    process.exitCode = 1
  }
}
