#!/usr/bin/env bun
/**
 * Prove that a test can fail: apply one exact-match edit to a production file, run each test
 * command against the mutated owner, then restore the original bytes and verify their hash.
 *
 * Usage:
 *   bun run scripts/typescript/mutation-proof.ts --file <path> --find <text> --replace <text> \
 *     --test '<label>=<argv...>' [--test ...] [--cwd <dir>] [--json]
 *
 *   --test takes "label=command words"; the command is split on spaces and quoting is not
 *   supported, so select a test by a pattern without spaces or run the whole file.
 *
 * Verdicts per test: red (exit != 0, the test caught the mutation) or green (exit 0, it did not).
 * The owner is restored on success, on a thrown error, and on SIGINT/SIGTERM.
 * Exit codes: 0 ran and restored, 1 the find text is empty or did not match exactly once or the
 * restore hash differed (the file was still restored), 2 usage, 130/143 interrupted and restored.
 * Read references/testing/junk-classes.md "Proof rule" for how to read a candidate/keeper pair.
 */

import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { parseArgs } from "node:util"

export type MutationTest = { readonly label: string; readonly command: readonly string[] }

export type MutationOutcome = {
  readonly label: string
  readonly command: readonly string[]
  readonly exitCode: number
  readonly verdict: "red" | "green"
  readonly outputTail: string
}

export type MutationResult = {
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly originalSha256: string
  readonly restoredSha256: string
  readonly outcomes: readonly MutationOutcome[]
}

export class MutationError extends Error {
  constructor(
    readonly kind: "FIND_EMPTY" | "FIND_NOT_UNIQUE" | "RESTORE_MISMATCH",
    message: string,
  ) {
    super(message)
    this.name = "MutationError"
  }
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

async function runCaptured(command: readonly string[], cwd: string): Promise<{ readonly exitCode: number; readonly outputTail: string }> {
  const child = Bun.spawn([...command], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const lines = `${stdout}${stderr}`.trimEnd().split("\n")
  return { exitCode, outputTail: lines.slice(-30).join("\n") }
}

export async function runMutation(options: {
  readonly cwd: string
  readonly file: string
  readonly find: string
  readonly replace: string
  readonly tests: readonly MutationTest[]
}): Promise<MutationResult> {
  if (options.find.length === 0) throw new MutationError("FIND_EMPTY", `${options.file}: find text is empty`)
  const full = resolve(options.cwd, options.file)
  const original = readFileSync(full)
  const text = original.toString("utf8")
  const occurrences = text.split(options.find).length - 1
  if (occurrences !== 1) {
    throw new MutationError("FIND_NOT_UNIQUE", `${options.file}: find matched ${occurrences} times (need exactly 1)`)
  }
  const originalSha256 = sha256(original)
  const outcomes: MutationOutcome[] = []
  const restoreOnSignal = (signal: NodeJS.Signals): void => {
    writeFileSync(full, original)
    process.exit(signal === "SIGINT" ? 130 : 143)
  }
  process.on("SIGINT", restoreOnSignal)
  process.on("SIGTERM", restoreOnSignal)
  try {
    writeFileSync(full, text.replace(options.find, () => options.replace))
    for (const test of options.tests) {
      const run = await runCaptured(test.command, options.cwd)
      outcomes.push({
        label: test.label,
        command: test.command,
        exitCode: run.exitCode,
        verdict: run.exitCode === 0 ? "green" : "red",
        outputTail: run.outputTail,
      })
    }
  } finally {
    writeFileSync(full, original)
    process.off("SIGINT", restoreOnSignal)
    process.off("SIGTERM", restoreOnSignal)
  }
  const restoredSha256 = sha256(readFileSync(full))
  if (restoredSha256 !== originalSha256) {
    throw new MutationError("RESTORE_MISMATCH", `${options.file} not restored byte for byte`)
  }
  return { file: options.file, find: options.find, replace: options.replace, originalSha256, restoredSha256, outcomes }
}

function parseTest(spec: string): MutationTest | undefined {
  const separator = spec.indexOf("=")
  if (separator <= 0) return undefined
  const label = spec.slice(0, separator)
  const command = spec
    .slice(separator + 1)
    .split(" ")
    .filter((word) => word.length > 0)
  return command.length === 0 ? undefined : { label, command }
}

function usage(): number {
  console.error(
    "usage: mutation-proof.ts --file <path> --find <text> --replace <text> --test '<label>=<argv...>' [--test ...] [--cwd <dir>] [--json]",
  )
  return 2
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      file: { type: "string" },
      find: { type: "string" },
      replace: { type: "string" },
      test: { type: "string", multiple: true },
      cwd: { type: "string", default: process.cwd() },
      json: { type: "boolean", default: false },
    },
    strict: true,
  })
  if (values.file === undefined || values.find === undefined || values.replace === undefined || values.test === undefined) {
    return usage()
  }
  const tests: MutationTest[] = []
  for (const spec of values.test) {
    const parsed = parseTest(spec)
    if (parsed === undefined) return usage()
    tests.push(parsed)
  }
  try {
    const result = await runMutation({
      cwd: values.cwd ?? process.cwd(),
      file: values.file,
      find: values.find,
      replace: values.replace,
      tests,
    })
    if (values.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      for (const outcome of result.outcomes) console.log(`${outcome.label}: ${outcome.verdict} (exit ${outcome.exitCode})`)
      console.log(`restored ${result.file} (sha256 ${result.restoredSha256.slice(0, 12)})`)
    }
    return 0
  } catch (error) {
    if (error instanceof MutationError) {
      console.error(`mutation-proof: ${error.kind}: ${error.message}`)
      return 1
    }
    throw error
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
