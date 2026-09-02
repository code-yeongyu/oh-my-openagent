export const ULW_LOOP_DIR = ".omo/ulw-loop";
export const ULW_LOOP_BRIEF = "brief.md";
export const ULW_LOOP_GOALS = "goals.json";
export const ULW_LOOP_LEDGER = "ledger.jsonl";
export const ULW_LOOP_STEERING_MUTATION_KINDS = [
    "add_subgoal",
    "split_subgoal",
    "reorder_pending",
    "revise_pending_wording",
    "revise_criterion",
    "annotate_ledger",
    "mark_blocked_superseded",
];
export const ULW_LOOP_SUCCESS_CRITERION_USER_MODELS = [
    "happy",
    "edge",
    "regression",
    "adversarial",
];
export const ULW_LOOP_CRITERION_STATUSES = ["pending", "pass", "fail", "blocked"];
export const ULW_LOOP_LEDGER_EVENT_KINDS = [
    "plan_created",
    "goal_started",
    "goal_resumed",
    "goal_completed",
    "goal_blocked",
    "goal_failed",
    "goal_needs_user_decision",
    "goal_retried",
    "aggregate_completed",
    "aggregate_objective_migrated",
    "goal_added",
    "steering_accepted",
    "steering_rejected",
    "final_review_failed",
    "goal_review_blocked",
    "evidence_captured",
    "criterion_failed",
    "criterion_blocked",
    "criteria_revised",
    "batch_closed",
    "batch_updated",
];
