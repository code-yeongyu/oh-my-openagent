export interface MonitorFilterResult {
    filter: {
        matches(text: string): boolean;
    } | null;
    error?: string;
    pattern?: string;
}
export declare function createMonitorFilter(pattern: string | undefined, opts: {
    patternMaxLength: number;
}): MonitorFilterResult;
