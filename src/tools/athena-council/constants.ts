export const ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE = `Execute Athena's multi-model council for exactly ONE member per call.

Pass members as a single-item array containing one member name or model ID. Athena should call this tool once per selected member.

This tool launches the selected member as a background task and returns task/session metadata immediately.
After launching ALL members, STOP and wait — the system will notify you when tasks complete.
Only then call background_output(task_id=...) once per member to collect results. Do NOT poll in a loop.

{members}

IMPORTANT: This tool is designed for Athena agent use only. It requires council configuration to be present.`
