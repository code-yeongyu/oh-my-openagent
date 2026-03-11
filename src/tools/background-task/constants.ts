export const BACKGROUND_TASK_DESCRIPTION = `Run agent task in background. Returns task_id immediately; notifies on completion.

Use \`background_output\` to get results. Prompts MUST be in English.`

export const BACKGROUND_OUTPUT_DESCRIPTION = `Get output from background task. Use full_session=true to fetch session messages with filters. System notifies on completion, so block=true rarely needed. All timeout values are in milliseconds (ms), NOT seconds.`

export const BACKGROUND_WAIT_DESCRIPTION = `Wait for the next background task to complete from a set of task IDs. Returns as soon as ANY one finishes, with metadata-only completed_tasks array (task_id, description, status, duration_s, session_id, output_file_path). Use background_output to fetch full results. Call repeatedly with remaining IDs until all are done. All timeouts are in milliseconds (ms), NOT seconds; for example, timeout=120000 for 2 minutes.`

export const BACKGROUND_CANCEL_DESCRIPTION = `Cancel running background task(s). Use all=true to cancel ALL before final answer.`
