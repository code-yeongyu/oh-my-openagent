import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
export declare function prepareDelegateTaskArgs(args: Record<string, unknown>, ctx: ToolContextWithMetadata): Promise<DelegateTaskArgs>;
