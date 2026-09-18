import type { LookAtArgs } from "./types";
export interface LookAtFilePart {
    type: "file";
    mime: string;
    url: string;
    filename: string;
}
export interface LookAtTextPart {
    type: "text";
    text: string;
}
export type LookAtInputPart = LookAtFilePart | LookAtTextPart;
export interface PreparedLookAtInput {
    readonly inputParts: LookAtInputPart[];
    readonly sourceDescription: string;
    cleanup(): void;
}
type PrepareLookAtInputResult = {
    ok: true;
    value: PreparedLookAtInput;
} | {
    ok: false;
    error: string;
};
export declare function prepareLookAtInput(args: LookAtArgs): PrepareLookAtInputResult;
export {};
