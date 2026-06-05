import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { RUN_VALIDATION_SCHEMA } from "./types"
import type { RunValidationArgs } from "./types"
import { runValidator } from "./validator"

export const RUN_VALIDATION_DESCRIPTION = `Run user-provided validation code and return structured pass/fail results.

PURPOSE: Agents write their own validation rules as executable code, then run them against their own outputs. This transforms soft prompt instructions into hard, deterministic constraints.

HOW IT WORKS:
1. You write a validation function in Python (or TypeScript/shell)
2. The function receives your draft output as JSON via stdin
3. It prints {"passed": true/false, "errors": [...]} as the last line of stdout
4. If validation fails, you see exactly which errors to fix
5. Fix the errors, re-validate, then send the cleaned output

EXAMPLE — Validate file paths:
run_validation(
  language="python",
  code="import json,sys;d=json.load(sys.stdin);e=[f'Bad: {p}' for p in d.get('paths',[]) if not p.startswith('/')];print(json.dumps({'passed':len(e)==0,'errors':e}))",
  inputs='{"paths": ["/src/main.ts", "README.md"]}'
)

EXAMPLE — Validate citations:
run_validation(
  language="python",
  code="import json,sys;d=json.load(sys.stdin);e=[];[(lambda i,c,s:e.append(f'Claim {i} missing source: {c[:60]}')) for i,(c,s) in enumerate(zip(d.get('claims',[]),d.get('sources',[]))) if not s];print(json.dumps({'passed':len(e)==0,'errors':e}))",
  inputs='{"claims":["X uses Y","A uses B"],"sources":["https://x.dev",""]}'
)`

export function createRunValidationTool(): ToolDefinition {
  return tool({
    description: RUN_VALIDATION_DESCRIPTION,
    args: {
      language: RUN_VALIDATION_SCHEMA.language,
      code: RUN_VALIDATION_SCHEMA.code,
      inputs: RUN_VALIDATION_SCHEMA.inputs,
      timeout_seconds: RUN_VALIDATION_SCHEMA.timeout_seconds,
    },
    async execute(rawArgs: RunValidationArgs) {
      return await runValidator(rawArgs)
    },
  })
}
