/**
 * Kimi K3-native Sisyphus-Junior prompt.
 *
 * Authored for K3 as a complete prompt, not a K2.7 tune with a calibration
 * appendix. K3 keeps K2.7's restrained, outcome-first steerability and pushes
 * the thinking policy harder toward long-horizon reasoning. On a focused
 * executor that depth pays off in multi-step debugging and failure diagnosis;
 * left unshaped it keeps reasoning after the decisive condition is met. The
 * stop conditions are therefore woven into the sections where they act — the
 * role, the task read, the tool loop — with verification rigor first-class.
 */
export declare function buildKimiK3SisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
