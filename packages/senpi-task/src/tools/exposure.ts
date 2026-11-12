// The task family is eval-only, like bash (Q 2026-11-09): while an eval tool is registered, senpi withholds
// these definitions from the model's direct tool list and a cell reaches them as tool.task(...),
// tool.task_send(...), tool.task_output(...); without an eval tool they are ordinary direct tools.
// senpi-codemode counts eval-exposed tools as reachable for its agent()/output() helpers.
export const TASK_FAMILY_EXPOSURE = "eval" as const
