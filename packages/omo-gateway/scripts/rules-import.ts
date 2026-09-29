#!/usr/bin/env bun
// Import a prose rules file + a mapping table into rule files (format: src/rules/rules-import.ts).
//
//   bun packages/omo-gateway/scripts/rules-import.ts --from <rules.md> --map <map.json> --out <dir> [--json]
//       writes a fresh rules repository at <dir>/rules (read it with rules-demo.ts --rules-dir <dir>/rules)
//   bun packages/omo-gateway/scripts/rules-import.ts --from <rules.md> --map <map.json> --rules-dir <repo>
//   bun packages/omo-gateway/scripts/rules-import.ts --from <rules.md> --map <map.json> --memory-home <root> --identity <id>
//   bun packages/omo-gateway/scripts/rules-import.ts --from <rules.md> --map <map.json> --dry-run   # plan only, writes nothing

import { readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { parseArgs } from "node:util"
import { RuleFormatError } from "../src/rules/format"
import { importRules, parseImportMap, planImport, RulesImportError } from "../src/rules/rules-import"
import { RulesStore, RulesStoreError } from "../src/rules/store"

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    map: { type: "string" },
    out: { type: "string" },
    "rules-dir": { type: "string" },
    "memory-home": { type: "string" },
    identity: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
  strict: true,
})

function usage(message: string): never {
  process.stderr.write(`rules-import: ${message}\n`)
  process.exit(2)
}

async function openStore(): Promise<RulesStore> {
  const targets = [values.out, values["rules-dir"], values["memory-home"]].filter((value) => value !== undefined)
  if (targets.length !== 1) usage("pass exactly one of --out <dir>, --rules-dir <repo> or --memory-home <root> --identity <id>")
  if (values.out !== undefined) return RulesStore.openDir({ dir: join(values.out, "rules") })
  if (values["rules-dir"] !== undefined) return RulesStore.openDir({ dir: values["rules-dir"] })
  if (values.identity === undefined) usage("--memory-home needs --identity <id>")
  return RulesStore.openIdentity({ memoryHome: values["memory-home"] ?? "", identity: values.identity })
}

async function main(): Promise<void> {
  if (values.from === undefined || values.map === undefined) usage("--from <rules.md> and --map <map.json> are required")
  const prose = await readFile(values.from, "utf8")
  const map = parseImportMap(JSON.parse(await readFile(values.map, "utf8")))
  const plan = planImport(prose, basename(values.from), map)
  if (values["dry-run"]) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
    return
  }
  const store = await openStore()
  const { imported, skipped } = await importRules(store, map.gateway, plan)
  const version = await store.version()
  if (values.json) {
    process.stdout.write(`${JSON.stringify({ gateway: map.gateway, version, imported, skipped }, null, 2)}\n`)
    return
  }
  process.stdout.write(`imported ${imported.length} rule(s) into scope ${map.gateway} (version ${version ?? "none"})\n`)
  for (const { rule, path } of imported) {
    const gate = rule.gate === null ? "behavioral" : `${rule.gate} ${JSON.stringify(rule.params)}`
    process.stdout.write(`  ${rule.n}. ${path} ${gate} <- ${rule.source ?? ""}\n`)
  }
  for (const entry of skipped) process.stdout.write(`  skipped ${entry.source} (${entry.kind}): already rule ${entry.n}\n`)
}

try {
  await main()
} catch (error) {
  if (!(error instanceof RulesImportError || error instanceof RuleFormatError || error instanceof RulesStoreError || error instanceof SyntaxError)) throw error
  process.stderr.write(`rules-import: rejected: ${error.message}\n`)
  process.exit(1)
}
