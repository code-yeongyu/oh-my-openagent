import type { GoalStatus } from "./types";
export type ParsedGoalCommand = {
    readonly kind: "show";
} | {
    readonly kind: "clear";
} | {
    readonly kind: "setStatus";
    readonly status: Extract<GoalStatus, "active" | "paused">;
} | {
    readonly kind: "setObjective";
    readonly objective: string;
};
export declare function parseGoalCommand(rawArgs: string): ParsedGoalCommand;
