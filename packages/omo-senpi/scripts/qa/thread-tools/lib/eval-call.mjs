/**
 * How the fake model reaches an eval-only tool (oh-my-openagent#12903): the thread family is withheld
 * from the engine's direct tool list whenever `eval` is registered, so a `QA:CALL thread_send ...`
 * directive is emitted as an eval cell that calls `tool.thread_send(...)` and prints the tool's own
 * text. The scenarios keep asserting on the tool they named: `calledToolName` maps the eval cell
 * back to it when the result returns.
 */

const WRAPPED_CALL = /await tool\.([A-Za-z0-9_]+)\(/

export function planModelToolCall(call, advertisedTools) {
  if (advertisedTools.includes(call.name) || !advertisedTools.includes("eval")) return call
  return {
    name: "eval",
    args: {
      language: "js",
      summary: `QA: ${call.name} through eval`,
      code: `const outcome = await tool.${call.name}(${JSON.stringify(call.args ?? {})});\nprint(outcome.text);`,
    },
  }
}

export function calledToolName(functionName, argumentsJson) {
  if (functionName !== "eval") return functionName
  let code
  try {
    code = JSON.parse(argumentsJson ?? "{}")?.code
  } catch {
    return functionName
  }
  return (typeof code === "string" ? WRAPPED_CALL.exec(code)?.[1] : undefined) ?? functionName
}
