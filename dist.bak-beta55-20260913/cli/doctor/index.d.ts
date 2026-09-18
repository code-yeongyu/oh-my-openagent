import type { DoctorOptions } from "./framework/types";
export declare function doctor(options?: DoctorOptions): Promise<number>;
export declare function formatDoctorFailure(error: unknown): string[];
export * from "./framework/types";
export { runDoctor } from "./runner";
export { resolveDoctorTarget } from "./framework/doctor-target";
export { formatDoctorOutput, formatJsonOutput } from "./framework/formatter";
