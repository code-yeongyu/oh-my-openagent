import { type SgProvisionOptions, type SgResolverOptions } from "@oh-my-opencode/utils";
export interface AstGrepSgProvisionEventInput {
    readonly event: {
        readonly type: string;
    };
}
export interface AstGrepSgProvisionDeps {
    readonly arch?: string;
    readonly findSgBinary: (options: SgResolverOptions) => string | null;
    readonly homeDir: () => string;
    readonly log: (message: string, data?: Record<string, unknown>) => void;
    readonly platform?: NodeJS.Platform;
    readonly provisionSgBinary: (options: SgProvisionOptions) => Promise<string>;
    readonly schedule: (task: () => Promise<void>) => void;
}
export declare function clearAstGrepSgProvisionTargetsForTesting(): void;
export declare function createAstGrepSgProvisionHook(depsOverride?: Partial<AstGrepSgProvisionDeps>): {
    event(input: AstGrepSgProvisionEventInput): void;
};
