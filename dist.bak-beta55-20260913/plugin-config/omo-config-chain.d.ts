import { type OmoConfigEnv } from "@oh-my-opencode/omo-config-core";
export type OmoOpenCodeConfigView = {
    readonly config: Record<string, unknown>;
    readonly path: string;
};
export type OmoOpenCodeConfigChain = {
    readonly diagnostics: readonly {
        readonly message: string;
        readonly path: string;
    }[];
    readonly protectedUserView: Record<string, unknown>;
    readonly views: readonly OmoOpenCodeConfigView[];
};
export declare function loadOmoOpenCodeConfigChain(directory: string, environment?: OmoConfigEnv): OmoOpenCodeConfigChain;
