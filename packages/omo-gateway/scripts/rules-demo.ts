#!/usr/bin/env bun
// Scripted entry point for the conversation rules store until `omo gateway rules` lands (todo 17).
//
//   bun packages/omo-gateway/scripts/rules-demo.ts --memory-home <root> [--identity <id>]   # demo: 3 rules + compile for C1
//   bun packages/omo-gateway/scripts/rules-demo.ts --rules-dir <dir> --add --chat C1 --kind mechanical --gate language --params '{"allow":["en"]}' --text "English only."
//   bun packages/omo-gateway/scripts/rules-demo.ts --memory-home <root> --list [--json]
//   bun packages/omo-gateway/scripts/rules-demo.ts --memory-home <root> --compile --chat C1

import { parseArgs } from "node:util"
import { RuleFormatError, type RuleKind } from "../src/rules/format"
import { RulesStore, RulesStoreError, type NewRule, type RuleSet } from "../src/rules/store"

const { values } = parseArgs({
  options: {
    "memory-home": { type: "string" },
    identity: { type: "string", default: "demo-gateway" },
    "rules-dir": { type: "string" },
    scope: { type: "string", default: "demo" },
    add: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
    compile: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    surface: { type: "string" },
    chat: { type: "string" },
    thread: { type: "string" },
    user: { type: "string" },
    requester: { type: "string" },
    kind: { type: "string", default: "behavioral" },
    gate: { type: "string" },
    params: { type: "string" },
    text: { type: "string" },
    locked: { type: "boolean", default: false },
    "set-by": { type: "string", default: "u_000DEMO" },
  },
  strict: true,
})

function usage(message: string): never {
  process.stderr.write(`rules-demo: ${message}\n`)
  process.exit(2)
}

async function openStore(): Promise<RulesStore> {
  if (values["rules-dir"] !== undefined) return RulesStore.openDir({ dir: values["rules-dir"] })
  if (values["memory-home"] !== undefined) {
    return RulesStore.openIdentity({ memoryHome: values["memory-home"], identity: values.identity })
  }
  return usage("pass --memory-home <root> [--identity <id>] or --rules-dir <dir>")
}

function parseKind(value: string): RuleKind {
  if (value === "mechanical" || value === "behavioral") return value
  return usage(`--kind must be mechanical or behavioral, got ${value}`)
}

function ruleFromFlags(): NewRule {
  if (values.text === undefined) usage("--add needs --text")
  const params: unknown = values.params === undefined ? undefined : JSON.parse(values.params)
  const input = {
    scope: {
      gateway: values.scope,
      surface: values.surface ?? null,
      chat: values.chat ?? null,
      thread: values.thread ?? null,
      user: values.user ?? null,
    },
    kind: parseKind(values.kind),
    set_by: values["set-by"],
    locked: values.locked,
    text: values.text,
  }
  if (values.gate !== undefined) Reflect.set(input, "gate", values.gate)
  if (params !== undefined) Reflect.set(input, "params", params)
  return input
}

function printSet(set: RuleSet): void {
  if (values.json) {
    process.stdout.write(`${JSON.stringify(set, null, 2)}\n`)
    return
  }
  process.stdout.write(`scope ${set.gateway} at version ${set.version ?? "(none)"}\n`)
  for (const { rule } of set.rules) {
    const where = rule.scope.thread ?? rule.scope.chat ?? rule.scope.surface ?? "scope-wide"
    const gate = rule.gate === null ? "behavioral" : `${rule.gate} ${JSON.stringify(rule.params)}`
    process.stdout.write(`  ${rule.n}. [${rule.status}${rule.locked ? ", locked" : ""}] ${where} ${gate}: ${rule.text}\n`)
  }
  for (const { path, reason } of set.rejected) process.stdout.write(`  REJECTED ${path}: ${reason}\n`)
}

async function compileFor(store: RulesStore, chat: string | undefined): Promise<void> {
  const { compiled, rejected } = await store.compile({
    gateway: values.scope,
    surface: values.surface ?? null,
    chat: chat ?? null,
    thread: values.thread ?? null,
    requester: values.requester ?? null,
  })
  process.stdout.write(`${JSON.stringify(compiled, null, 2)}\n`)
  for (const { path, reason } of rejected) process.stdout.write(`REJECTED ${path}: ${reason}\n`)
}

async function demo(store: RulesStore): Promise<void> {
  const demoRules: readonly NewRule[] = [
    { scope: { gateway: values.scope }, kind: "mechanical", gate: "language", params: { allow: ["en"] }, set_by: values["set-by"], text: "English only in this workspace." },
    { scope: { gateway: values.scope, chat: "C1" }, kind: "mechanical", gate: "language", params: { allow: ["en", "ko"] }, set_by: values["set-by"], text: "English or Korean in C1." },
    { scope: { gateway: values.scope, chat: "C1" }, kind: "behavioral", set_by: values["set-by"], text: "Tag the requester on every status change." },
  ]
  for (const input of demoRules) {
    const { rule } = await store.add(input)
    process.stdout.write(`added rule ${rule.n} (${rule.id}): ${rule.text}\n`)
  }
  process.stdout.write("compiled rules for chat C1:\n")
  await compileFor(store, "C1")
  const head = await store.repo.head()
  const version = await store.version()
  process.stdout.write(`repo HEAD: ${head}\nversion == HEAD: ${version === head}\n`)
  if (version !== head) process.exit(1)
}

async function main(): Promise<void> {
  const store = await openStore()
  if (values.add) {
    const { rule, path } = await store.add(ruleFromFlags())
    process.stdout.write(values.json ? `${JSON.stringify({ rule, path }, null, 2)}\n` : `added rule ${rule.n} at ${path}\n`)
  } else if (values.list) {
    printSet(await store.load(values.scope))
  } else if (values.compile) {
    await compileFor(store, values.chat)
  } else {
    await demo(store)
  }
}

try {
  await main()
} catch (error) {
  if (!(error instanceof RuleFormatError || error instanceof RulesStoreError)) throw error
  process.stderr.write(`rules-demo: rejected: ${error.message}\n`)
  process.exit(1)
}
