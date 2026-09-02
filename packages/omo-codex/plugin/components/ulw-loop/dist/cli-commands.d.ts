export declare const ULW_LOOP_SUBCOMMANDS: readonly ["help", "create-goals", "status", "complete-goals", "checkpoint", "steer", "add-goal", "criteria", "record-evidence", "record-review-blockers"];
export type UlwLoopSubcommand = (typeof ULW_LOOP_SUBCOMMANDS)[number];
export declare function isUlwLoopSubcommand(value: string): value is UlwLoopSubcommand;
export declare function ulwLoopCommand(argv: readonly string[]): Promise<number>;
