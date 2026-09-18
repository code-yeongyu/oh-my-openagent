import type { OhMyOpenCodeConfig } from "../config";
import type { ModelCacheState } from "../plugin-state";
export { resolveCategoryConfig } from "./category-config-resolver";
export interface ConfigHandlerDeps {
    ctx: {
        directory: string;
        client?: unknown;
    };
    pluginConfig: OhMyOpenCodeConfig;
    modelCacheState: ModelCacheState;
    runtimeSkillSourceUrl?: string;
}
export declare function createConfigHandler(deps: ConfigHandlerDeps): (config: Record<string, unknown>) => Promise<void>;
