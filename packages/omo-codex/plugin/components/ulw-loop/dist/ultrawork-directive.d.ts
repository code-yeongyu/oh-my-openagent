import { type UltraworkAdditionalContextOptions } from "./ultrawork-skill-pointer.js";
export interface UltraworkDirectiveInput {
    readonly prompt: string;
    readonly transcript_path?: string | null;
}
export declare function buildUltraworkDirectiveOutput(input: UltraworkDirectiveInput, options?: UltraworkAdditionalContextOptions): string;
