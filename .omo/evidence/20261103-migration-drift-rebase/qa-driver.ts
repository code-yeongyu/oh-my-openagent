import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runOpenCodeStartupMigration } from "./packages/omo-opencode/src/startup-migration"

const home = mkdtempSync(join(tmpdir(), "migration-drift-qa-"))
mkdirSync(join(home, ".omo"), { recursive: true })
mkdirSync(join(home, ".config/opencode"), { recursive: true })
// user-shaped target: documented agent keys + a genuinely unknown future key + retired codegraph
writeFileSync(join(home, ".omo/omo.jsonc"), JSON.stringify({
  agents: {
    sisyphus: { ultrawork: { model: "anthropic/claude-opus-5" }, compaction: { model: "anthropic/claude-sonnet-5" }, some_future_key: { deep: true } },
    hephaestus: { allow_non_gpt_model: true },
  },
  "[codex]": { codegraph: { enabled: true } },
}, null, 2))
writeFileSync(join(home, ".config/opencode/oh-my-openagent.jsonc"), JSON.stringify({ task: { default_concurrency: 3 } }))

const result = runOpenCodeStartupMigration({ cwd: home, homeDir: home, environment: { HOME: home } })
console.log(JSON.stringify({
  error: result.error ?? null,
  plans: result.results.map((r) => ({ id: r.id, status: r.status, diagnostics: r.diagnostics })),
}, null, 2))
console.log("--- target after ---")
console.log(readFileSync(join(home, ".omo/omo.jsonc"), "utf-8"))
