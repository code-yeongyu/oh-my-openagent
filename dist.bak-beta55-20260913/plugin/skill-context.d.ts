import type { AvailableSkill } from "../agents/dynamic-agent-prompt-builder";
import type { OhMyOpenCodeConfig } from "../config";
import type { BrowserAutomationProvider } from "../config/schema/browser-automation";
import type { LoadedSkill } from "../features/opencode-skill-loader/types";
import { collectDisabledSkillAliases } from "../features/opencode-skill-loader";
export type SkillContext = {
    mergedSkills: LoadedSkill[];
    availableSkills: AvailableSkill[];
    browserProvider: BrowserAutomationProvider;
    disabledSkills: Set<string>;
};
export { collectDisabledSkillAliases };
export declare function createSkillContext(args: {
    directory: string;
    pluginConfig: OhMyOpenCodeConfig;
    /**
     * Host skill config from opencode's merged runtime config (e.g. fetched via
     * the plugin client). Includes runtime-injected `skills.paths` from other
     * plugins. When omitted, falls back to reading the on-disk opencode config.
     */
    hostSkills?: {
        paths?: string[];
        urls?: string[];
    };
}): Promise<SkillContext>;
