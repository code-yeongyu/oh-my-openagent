import type { BoulderCliResult } from "./types";
export declare function formatTextOutput(result: BoulderCliResult): string;
export declare function formatJsonOutput(result: BoulderCliResult): string;
export declare function formatNoBoulderMessage(isJson: boolean | undefined): string;
export declare function formatReadErrorMessage(isJson: boolean | undefined): string;
