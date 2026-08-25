// Provenance: @code-yeongyu/senpi dist core/extensions/builtin/claude-sdk-oauth/tools.js
// (HOST_TOOL_EXECUTION_DENIED_MESSAGE). The lane's HOST_TOOL_DENIAL_HOOKS return this sentence as
// the PreToolUse permissionDecisionReason for every host-captured tool, and options.js wires those
// hooks into each claude-sdk-oauth query, so the text reaches the model transcript and can leak
// into assistant replies and later turns. Pinned locally because adapter components must not
// value-import the senpi runtime; the co-located drift tripwire test fails when the host rewords it.
export const HOST_TOOL_DENIAL_LEAK_TEXT =
  "This tool call is captured and executed by the host. Do not retry with other tools; end the turn."

export const HOST_DENIAL_REPLACEMENT_TEXT = "[host tool handoff]"
