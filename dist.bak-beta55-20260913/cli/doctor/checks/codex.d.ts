import { type CodexInstallationDetection } from "../../install-codex";
import type { CheckResult, CodexDoctorSummary } from "../framework/types";
type DetectCodexInstallation = () => Promise<CodexInstallationDetection>;
export interface CodexDoctorDeps {
    readonly codexHome?: string;
    readonly binDir?: string;
    readonly detectCodexInstallation?: DetectCodexInstallation;
    readonly installerVersion?: string;
}
export declare function gatherCodexSummary(deps?: CodexDoctorDeps): Promise<CodexDoctorSummary>;
export declare function checkCodex(deps?: CodexDoctorDeps): Promise<CheckResult>;
export {};
