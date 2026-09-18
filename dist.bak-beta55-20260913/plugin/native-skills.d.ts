import type { SkillLoadOptions } from "../tools/skill/types";
import type { PluginContext } from "./types";
type NativeSkills = NonNullable<SkillLoadOptions["nativeSkills"]>;
export declare function getPluginInputNativeSkills(ctx: PluginContext): NativeSkills | undefined;
export declare function createNativeSkills(input: {
    readonly client: PluginContext["client"];
    readonly directory: string;
}): NativeSkills;
export {};
