import { type PluginEntry } from "../../shared";
interface ParseConfigResult {
    config: OpenCodeConfig | null;
    error?: string;
}
export interface OpenCodeConfig {
    plugin?: PluginEntry[];
    [key: string]: unknown;
}
export declare function parseOpenCodeConfigFileWithError(path: string): ParseConfigResult;
export {};
