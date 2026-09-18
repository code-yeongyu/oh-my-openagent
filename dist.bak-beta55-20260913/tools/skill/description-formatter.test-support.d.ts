import type { CommandInfo } from "../slashcommand/types";
import type { SkillInfo } from "./types";
export declare function makeSkill(name: string, description?: string, overrides?: Partial<SkillInfo>): SkillInfo;
export declare function sharedSkill(name: string, description?: string): SkillInfo;
export declare function builtinSharedSkill(name: string, description?: string): SkillInfo;
export declare function localSkill(name: string, description?: string): SkillInfo;
export declare function userSkill(name: string, description?: string): SkillInfo;
export declare function opencodeNativeSkill(name: string, description?: string, location?: string): SkillInfo;
export declare function makeCommand(name: string, description?: string, overrides?: Partial<CommandInfo>): CommandInfo;
