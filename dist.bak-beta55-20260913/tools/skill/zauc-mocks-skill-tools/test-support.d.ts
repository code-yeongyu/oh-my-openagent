import type { ToolContext } from "@opencode-ai/plugin/tool";
import type { LoadedSkill } from "../../../features/opencode-skill-loader/types";
import type { CommandInfo } from "../../slashcommand/types";
import type { SkillLoadOptions } from "../types";
type SkillToolFactory = typeof import("../tools").createSkillTool;
type TestSkillLoadOptions = Omit<SkillLoadOptions, "directory"> & {
    readonly directory?: SkillLoadOptions["directory"];
};
export declare function createSkillTool(options?: TestSkillLoadOptions): ReturnType<SkillToolFactory>;
export declare function createMockSkill(name: string, options?: {
    readonly agent?: string;
    readonly scope?: LoadedSkill["scope"];
}): LoadedSkill;
export declare function createMockSkillWithMcp(name: string, mcpServers: Record<string, unknown>): LoadedSkill;
export declare function createMockCommand(name: string, scope: CommandInfo["scope"]): {
    name: string;
    path: string;
    metadata: {
        name: string;
        description: string;
    };
    scope: import("../../slashcommand").CommandScope;
};
export declare const mockContext: ToolContext;
export {};
