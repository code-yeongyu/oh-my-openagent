import { createPrometheusMdOnlyHook } from "../hook"
import { clearSessionAgent, setSessionAgent } from "../../../features/claude-code-session-state"
import { createHashlineEditTool } from "../../../tools/hashline-edit/tools"
import type { RawHashlineEdit } from "../../../tools/hashline-edit/normalize-edits"

const args: { filePath: string; rename?: string; delete?: boolean; edits: RawHashlineEdit[] } = JSON.parse(process.argv[2])
const sessionID = "ses_guarded_hashline_fixture"
const root = process.cwd()
const hook = createPrometheusMdOnlyHook({ directory: root, client: {} } as never)
const output = { args }
if (process.argv[3] === "frozen") Object.freeze(output.args)

async function execute() {
  setSessionAgent(sessionID, "prometheus")
  try {
    try {
      await hook["tool.execute.before"]({ tool: "edit", sessionID, callID: "guarded" }, output, { original: args })
    } catch (error) {
      return { blocked: true, error: String(error) }
    }
    // OpenCode session/tools.ts:106-111 discards trigger's wrapper, retaining args.
    const result = await createHashlineEditTool().execute(args, {
      sessionID, messageID: "guarded", agent: "prometheus", directory: root, worktree: root,
      abort: new AbortController().signal, metadata: () => {}, ask: async () => {},
    } as never)
    return { blocked: false, result, filePath: args.filePath, rename: args.rename }
  } finally {
    clearSessionAgent(sessionID)
  }
}

console.log(JSON.stringify(await execute()))
