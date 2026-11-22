import { resolveCategoryExecution as resolveCategoryExecutionImpl } from "../../../tools/delegate-task/category-resolver"
import { buildSystemContent as buildSystemContentImpl } from "../../../tools/delegate-task/prompt-builder"
import { resolveSubagentExecution as resolveSubagentExecutionImpl } from "../../../tools/delegate-task/subagent-resolver"

// Own forwarding functions, not re-exports: resolve-member.test.ts mocks this module, and a bun mock of a module that
// re-exports rebinds the functions inside the delegate-task modules themselves, which leaked into every later
// delegate-task test file in the process (#13331).
export const resolveCategoryExecution: typeof resolveCategoryExecutionImpl = (...args) =>
  resolveCategoryExecutionImpl(...args)
export const resolveSubagentExecution: typeof resolveSubagentExecutionImpl = (...args) =>
  resolveSubagentExecutionImpl(...args)
export const buildSystemContent: typeof buildSystemContentImpl = (...args) => buildSystemContentImpl(...args)
