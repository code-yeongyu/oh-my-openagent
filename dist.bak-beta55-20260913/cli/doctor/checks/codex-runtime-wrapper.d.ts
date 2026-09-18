import type { CheckResult } from "../framework/types";
export interface CodexRuntimeWrapperDoctorDeps {
    readonly binDir?: string;
    readonly codexHome?: string;
    readonly platform?: NodeJS.Platform;
}
export declare function checkCodexRuntimeWrapper(deps?: CodexRuntimeWrapperDoctorDeps): Promise<CheckResult>;
