import type { OhMyOpenCodeConfig, TmuxConfig } from "./config";
export { isInteractiveBashEnabled } from "./interactive-bash-availability";
export declare function isTmuxIntegrationEnabled(pluginConfig: {
    tmux?: {
        enabled?: boolean;
    } | undefined;
}): boolean;
export declare function createRuntimeTmuxConfig(pluginConfig: {
    tmux?: OhMyOpenCodeConfig["tmux"];
}): TmuxConfig;
