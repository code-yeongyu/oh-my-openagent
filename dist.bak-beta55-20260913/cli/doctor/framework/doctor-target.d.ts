export type DoctorTarget = "opencode" | "codex";
export declare function resolveDoctorTarget(invocationName: string | undefined, platform?: DoctorTarget): DoctorTarget;
