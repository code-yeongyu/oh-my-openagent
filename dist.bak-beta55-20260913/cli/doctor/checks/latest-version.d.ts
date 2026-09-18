import { type NpmDistTags } from "../../config-manager/npm-dist-tags";
import type { CodexDoctorSummary, DoctorTarget, SystemInfo } from "../framework/types";
export type FetchDistTags = (packageName: string) => Promise<NpmDistTags | null>;
export interface LatestVersionInput {
    target: DoctorTarget;
    systemInfo: SystemInfo;
    codex: CodexDoctorSummary | undefined;
    distTags: NpmDistTags | null;
}
export declare function gatherEditionDistTags(target: DoctorTarget, fetchDistTags?: FetchDistTags): Promise<NpmDistTags | null>;
export declare function resolveLatestVersion(input: LatestVersionInput): string | null;
