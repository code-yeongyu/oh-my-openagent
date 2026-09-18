import { type SgResolverOptions } from "@oh-my-opencode/utils";
import type { CheckResult } from "../framework/types";
import { type CodexDoctorDeps } from "./codex";
export declare const CODEX_COMPONENTS_CHECK_ID = "codex-components";
export declare const CODEX_COMPONENTS_CHECK_NAME = "codex-components";
export interface CodexComponentsDoctorDeps extends CodexDoctorDeps {
    readonly env?: Record<string, string | undefined>;
    readonly platform?: NodeJS.Platform;
    readonly arch?: string;
    readonly sgRunVersionProbeSync?: SgResolverOptions["runVersionProbeSync"];
    readonly sgWhich?: SgResolverOptions["which"];
}
export declare function checkCodexComponents(deps?: CodexComponentsDoctorDeps): Promise<CheckResult>;
