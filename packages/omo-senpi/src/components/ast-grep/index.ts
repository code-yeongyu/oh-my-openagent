import { existsSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export interface AstGrepComponentOptions {
  readonly env?: Record<string, string | undefined>
  readonly nodeExecutable?: string
  readonly resolveCwd?: () => string
  readonly resolveEntry?: () => string
}

const AST_GREP_COMPONENT_NAME = "ast-grep"
const AST_GREP_MCP_SERVER_NAME = "_ast_grep"
const PROJECT_CWD_ENV = "OMO_AST_GREP_PROJECT_CWD"
// Lets a bun-compiled host binary (process.execPath) execute the staged script;
// inert for node and for the bun interpreter itself.
const BUN_BE_BUN_ENV = "BUN_BE_BUN"

export function createAstGrepComponent(options: AstGrepComponentOptions = {}): OmoSenpiComponent {
  const env = options.env ?? process.env
  const nodeExecutable = options.nodeExecutable ?? process.execPath
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const resolveEntry = options.resolveEntry ?? resolvePackagedAstGrepEntry

  return {
    name: AST_GREP_COMPONENT_NAME,
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      if (typeof pi.registerMcpServer !== "function") {
        ctx.logger.info("omo-senpi ast-grep skipped: senpi ExtensionAPI does not expose registerMcpServer", {
          component: AST_GREP_COMPONENT_NAME,
        })
        return
      }

      const entry = resolveEntry()
      const entryStat = statSync(entry, { throwIfNoEntry: false })
      if (entryStat === undefined || !entryStat.isFile()) {
        ctx.logger.warn("omo-senpi ast-grep skipped: staged MCP runtime is missing", {
          component: AST_GREP_COMPONENT_NAME,
          entry,
        })
        return
      }

      pi.registerMcpServer(AST_GREP_MCP_SERVER_NAME, {
        type: "stdio",
        command: nodeExecutable,
        args: [entry, "mcp"],
        env: { [PROJECT_CWD_ENV]: env[PROJECT_CWD_ENV] ?? resolveCwd(), [BUN_BE_BUN_ENV]: "1" },
        enabled: true,
        lifecycle: "lazy",
      })
    },
  }
}

function resolvePackagedAstGrepEntry(importerUrl: string = import.meta.url): string {
  const packagedEntry = fileURLToPath(new URL("../runtime/ast-grep-mcp/cli.js", importerUrl))
  if (existsSync(packagedEntry)) return packagedEntry

  const sourceTreeEntry = fileURLToPath(new URL("../../../plugin/runtime/ast-grep-mcp/cli.js", importerUrl))
  return existsSync(sourceTreeEntry) ? sourceTreeEntry : packagedEntry
}
