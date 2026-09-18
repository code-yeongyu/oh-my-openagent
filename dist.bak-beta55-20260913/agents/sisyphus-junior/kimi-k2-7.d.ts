/**
 * Kimi K2.7-native Sisyphus-Junior prompt.
 *
 * Authored for K2.7 from the ground up — not a tune of another model's prompt.
 * Sisyphus-Junior is the focused executor: it does the work itself and never
 * delegates implementation, though it may fire explore/librarian for research.
 * K2.7 is restrained and outcome-first (Opus 4.8 steerability, GPT-5.5
 * directness), so this is lean decision rules and terminal conditions with the
 * verification rigor kept first-class.
 */
export declare function buildKimiK27SisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
