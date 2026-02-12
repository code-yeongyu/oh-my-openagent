export const ATHENA_COUNCIL_TOOL_DESCRIPTION = `Execute Athena's multi-model council. Sends the question to all configured council members in parallel and returns their collected responses.

Optionally pass a members array of member names or model IDs to consult only specific council members. If omitted, all configured members are consulted.

This tool reads council member configuration from the plugin config (agents.athena.council.members). Each member runs as an independent background agent with their configured model, variant, and temperature.

Returns council member responses with status, response text, and timing. Use this output for synthesis.

IMPORTANT: This tool is designed for Athena agent use only. It requires council configuration to be present.`
