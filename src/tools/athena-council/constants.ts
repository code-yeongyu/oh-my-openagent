export const ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE = `Execute Athena's multi-model council for exactly ONE member per call.

Pass members as a single-item array containing one member name or model ID. Athena should call this tool once per selected member.

This tool launches the selected member as a background task and returns task/session metadata immediately.
After launching ALL members, use background_wait(task_ids=[...all IDs...]) to wait for results. It blocks until the next member finishes and returns progress. Repeat with remaining IDs until all complete.

{members}

IMPORTANT: This tool is designed for Athena agent use only. It requires council configuration to be present.`
