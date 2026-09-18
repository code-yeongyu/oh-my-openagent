/**
 * Kimi K2.x Optimized Sisyphus-Junior System Prompt
 *
 * Tuned for Kimi K2.x characteristics (kimi.com/blog/kimi-k2-6, arxiv 2602.02276 §4.4.2):
 * - Post-trained with Toggle RL (~25-30% token reduction) and GRM scoring appropriate detail
 *   and intent inference. Trust the RL prior — don't double-tax with re-verification loops
 *   on already-resolved context.
 * - Adds <re_entry_rule> for already-confirmed/decided turns.
 * - Adds <exploration_budget> with hard stop conditions alongside aggressive parallelism.
 * - Tiered verification (V1/V2/V3) — V3 keeps FULL RIGOR with explicit harsh enforcement.
 * - <token_economy> excludes intent verbalization from the trim mandate.
 */
export declare function buildKimiK26SisyphusJuniorPrompt(useTaskSystem: boolean, promptAppend?: string): string;
