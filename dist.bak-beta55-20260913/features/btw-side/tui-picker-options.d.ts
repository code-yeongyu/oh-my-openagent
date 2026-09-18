import type { BtwSessionCatalog } from "./tui-session-catalog";
export type BtwPickerOption = {
    title: string;
    value: string;
    description: string;
    category: string;
    disabled?: boolean;
};
export type BtwPickerSelection = {
    type: "session";
    sessionID: string;
} | {
    type: "new";
    parentSessionID: string;
};
export declare function parseBtwPickerValue(value: string): BtwPickerSelection | undefined;
export declare function buildBtwPickerOptions(catalog: BtwSessionCatalog, currentSessionID: string): {
    options: BtwPickerOption[];
    current: string;
};
