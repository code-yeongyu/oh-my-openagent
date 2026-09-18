export type GptPromptIdentityKey = "gpt-5.5" | "gpt-5.6-sol" | "gpt-6-astra" | "gpt-family";
export declare function getGptPromptIdentityKey(model?: string): GptPromptIdentityKey;
export declare function getGptPromptIdentity(model?: string): string;
