import { type RunAstGrepSkillInstall } from "@oh-my-opencode/utils";
export interface OpenCodeAstGrepInstallOptions {
    readonly arch?: string;
    readonly homeDir?: string;
    readonly installer?: RunAstGrepSkillInstall;
    readonly log?: (message: string) => void;
    readonly platform?: NodeJS.Platform;
    readonly sharedSkillsRoot?: string;
}
export declare function installAstGrepForOpenCode(options?: OpenCodeAstGrepInstallOptions): Promise<void>;
