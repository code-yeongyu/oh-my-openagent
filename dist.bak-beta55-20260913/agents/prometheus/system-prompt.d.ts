export declare const PROMETHEUS_PERMISSION: {
    edit: "allow";
    bash: "allow";
    webfetch: "allow";
    question: "allow";
};
export declare const PROMETHEUS_SYSTEM_PROMPT: string;
export declare function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string;
