import type { InstallPlatform } from "./types";
export declare const STAR_REPOSITORIES: readonly ["code-yeongyu/oh-my-openagent", "code-yeongyu/lazycodex"];
export interface GitHubStarResult {
    readonly repository: string;
    readonly ok: boolean;
    readonly error?: string;
}
export type GitHubStarCommandRunner = (repository: string) => Promise<void>;
export declare function formatGitHubStarCommand(repository: string): string;
export declare function runGitHubStarCommand(repository: string): Promise<void>;
export declare function starGitHubRepositories(platform?: InstallPlatform, runCommand?: GitHubStarCommandRunner): Promise<readonly GitHubStarResult[]>;
