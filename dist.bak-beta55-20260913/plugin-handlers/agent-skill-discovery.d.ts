import type { LoadedSkill } from "../features/opencode-skill-loader";
import type { ApplyAgentConfigParams } from "./agent-config-types";
export declare function discoverAgentSkills(params: Pick<ApplyAgentConfigParams, "config" | "pluginConfig" | "ctx">): Promise<LoadedSkill[]>;
