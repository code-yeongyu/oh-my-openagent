#!/usr/bin/env bun
// script/keychain-helper-release.ts
// The release gate for the signed keychain helper (#11262): `verify <file>` fails unless the file
// is executable, carries both architectures, is signed with the frozen identifier by team
// 523JNR86LZ under the hardened runtime with no entitlements, and its designated requirement
// equals KEYCHAIN_HELPER_REQUIREMENT exactly. publish-platform.yml runs it on the freshly signed
// helper and on the copy a compiled darwin binary provisions at first launch.

import { spawnSync } from "node:child_process"
import { statSync } from "node:fs"

import {
  KEYCHAIN_HELPER_IDENTIFIER,
  KEYCHAIN_HELPER_REQUIREMENT,
  KEYCHAIN_HELPER_TEAM,
  UNIVERSAL,
} from "../packages/omo-native/keychain-helper/build"

export type ToolResult = { readonly status: number; readonly stdout: string; readonly stderr: string }
export type ToolRunner = (command: string, args: readonly string[]) => ToolResult

const runTool: ToolRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.error !== undefined) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

export function designatedRequirement(codesignOutput: string): string | undefined {
  const line = codesignOutput.split("\n").find((candidate) => candidate.startsWith("designated => "))
  // codesign -d -r- annotates field-existence clauses with /* exists */; the requirement itself is unchanged.
  return line
    ?.slice("designated => ".length)
    .replace(/\/\*.*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function detail(codesignOutput: string, key: string): string | undefined {
  const line = codesignOutput.split("\n").find((candidate) => candidate.startsWith(`${key}=`))
  return line?.slice(key.length + 1).trim()
}

function hasHardenedRuntime(codesignOutput: string): boolean {
  return /^CodeDirectory .*flags=0x[0-9a-f]*\([^)]*\bruntime\b[^)]*\)/m.test(codesignOutput)
}

export function keychainHelperFailures(file: string, run: ToolRunner = runTool, mode: number = statSync(file).mode): string[] {
  const failures: string[] = []
  if ((mode & 0o100) === 0) failures.push(`${file} is not executable by its owner (mode ${(mode & 0o777).toString(8)})`)

  const archs = run("lipo", ["-archs", file])
  const present = archs.stdout.trim().split(/\s+/)
  for (const arch of UNIVERSAL) {
    if (archs.status !== 0 || !present.includes(arch)) failures.push(`${file} lacks the ${arch} slice (lipo: ${archs.stdout.trim() || archs.stderr.trim()})`)
  }

  const strict = run("codesign", ["--verify", "--strict", "--all-architectures", "-R", `=${KEYCHAIN_HELPER_REQUIREMENT}`, file])
  if (strict.status !== 0) failures.push(`codesign --verify --strict against the helper requirement failed: ${strict.stderr.trim()}`)

  const requirement = run("codesign", ["-d", "-r-", file])
  const actual = designatedRequirement(`${requirement.stdout}\n${requirement.stderr}`)
  if (actual !== KEYCHAIN_HELPER_REQUIREMENT) failures.push(`designated requirement differs: expected ${KEYCHAIN_HELPER_REQUIREMENT}, got ${actual ?? "none"}`)

  const details = run("codesign", ["-dv", "--verbose=2", file])
  const text = `${details.stdout}\n${details.stderr}`
  const identifier = detail(text, "Identifier")
  if (identifier !== KEYCHAIN_HELPER_IDENTIFIER) failures.push(`Identifier=${identifier ?? "none"}, expected ${KEYCHAIN_HELPER_IDENTIFIER}`)
  const team = detail(text, "TeamIdentifier")
  if (team !== KEYCHAIN_HELPER_TEAM) failures.push(`TeamIdentifier=${team ?? "none"}, expected ${KEYCHAIN_HELPER_TEAM}`)
  if (!hasHardenedRuntime(text)) failures.push(`${file} lacks the hardened runtime flag`)

  const entitlements = run("codesign", ["-d", "--entitlements", "-", "--xml", file])
  if (entitlements.status !== 0) failures.push(`codesign could not read entitlements: ${entitlements.stderr.trim()}`)
  else if (entitlements.stdout.trim() !== "") failures.push(`${file} carries entitlements; the helper must have none`)
  return failures
}

if (import.meta.main) {
  const [command, file, extra] = process.argv.slice(2)
  if (command !== "verify" || file === undefined || extra !== undefined) {
    console.error("usage: bun script/keychain-helper-release.ts verify <file>")
    process.exit(2)
  }
  const failures = keychainHelperFailures(file)
  for (const failure of failures) console.error(`::error::${failure}`)
  if (failures.length > 0) process.exit(1)
  console.log(`${file}: ${KEYCHAIN_HELPER_IDENTIFIER}, team ${KEYCHAIN_HELPER_TEAM}, ${UNIVERSAL.join("+")}, designated requirement matches`)
}
