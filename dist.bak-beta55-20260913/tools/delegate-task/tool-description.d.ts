import type { AvailableCategory, AvailableSkill } from "../../agents/dynamic-agent-prompt-builder";
import type { DelegateTaskToolOptions } from "./types";
export interface DelegateTaskPresentation {
    availableCategories: AvailableCategory[];
    availableSkills: AvailableSkill[];
    categoryExamples: string;
    description: string;
}
type DelegateTaskPresentationOptions = Pick<DelegateTaskToolOptions, "availableCategories" | "availableSkills" | "userCategories">;
export declare function createDelegateTaskPresentation(options: DelegateTaskPresentationOptions): DelegateTaskPresentation;
export {};
