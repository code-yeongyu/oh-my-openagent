export const ATHENA_COUNCIL_TOOL_DESCRIPTION_TEMPLATE = `Execute Athena's multi-model council. Launches council members as background tasks and returns their task IDs immediately.

Optionally pass a members array of member names or model IDs to consult only specific council members. If omitted, all configured members are consulted.

{members}

Use background_output(task_id=...) to retrieve each member's response. The system will notify you when tasks complete.

IMPORTANT: This tool is designed for Athena agent use only. It requires council configuration to be present.`
