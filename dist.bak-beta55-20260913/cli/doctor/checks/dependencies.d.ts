import type { DependencyInfo } from "../framework/types";
export declare function checkAstGrepCli(): Promise<DependencyInfo>;
export declare function findCommentCheckerPackageBinary(baseDirOverride?: string, resolvePackageJsonPath?: () => string): string | null;
export declare function checkCommentChecker(): Promise<DependencyInfo>;
