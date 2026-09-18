/**
 * Kimi K2.x-native Sisyphus prompt — rewritten with 8-block architecture.
 *
 * Design principles (derived from kimi.com/blog/kimi-k2-6 + arxiv 2602.02276 §4.4.2):
 * - K2.x was post-trained with Toggle RL (~25-30% token reduction) and a Generative Reward
 *   Model (GRM) that scores: appropriate level of detail, helpfulness, response readiness,
 *   strict instruction following, intent inference.
 * - The model already has strong intent inference from RL training. Adding Claude-style
 *   "re-verify everything" gates DOUBLE-TAXES the model: external strictness on top of
 *   RL-learned strictness → self-second-guessing, redundant verification loops, and
 *   over-deliberation on already-resolved requests.
 * - Key fixes over gpt-5-4.ts:
 *   1. <re_entry_rule>: suppress re-verbalization for already-decided/confirmed turns
 *   2. <exploration_budget>: hard stop conditions alongside aggressive parallelism
 *   3. Tiered <verification_loop> (V1/V2/V3): trivial fixes don't trigger full
 *      lsp+tests+build+QA loop — V3 keeps FULL RIGOR with harsh enforcement language
 *   4. <token_economy>: verbalization explicitly EXCLUDED from trim mandate
 *
 * Architecture (8 blocks, same as gpt-5-4.ts):
 *   1. <identity>          - Role + K2.x-specific training hint
 *   2. <constraints>       - Hard blocks + anti-patterns
 *   3. <intent>            - Intent gate + verbalization + re_entry_rule
 *   4. <explore>           - Codebase assessment + research + tool rules + exploration_budget
 *   5. <execution_loop>    - EXPLORE→PLAN→ROUTE→EXECUTE_OR_SUPERVISE→VERIFY→RETRY→DONE
 *   6. <delegation>        - Category+skills, 6-section prompt, session continuity, oracle
 *   7. <tasks>             - Task/todo management (scoped threshold for K2.x)
 *   8. <style>             - Tone + output contract + token_economy
 */
import type { AvailableAgent, AvailableTool, AvailableSkill, AvailableCategory } from "../dynamic-agent-prompt-builder";
import { categorizeTools } from "../dynamic-agent-prompt-builder";
export declare function buildKimiK26SisyphusPrompt(model: string, availableAgents: AvailableAgent[], availableTools?: AvailableTool[], availableSkills?: AvailableSkill[], availableCategories?: AvailableCategory[], useTaskSystem?: boolean): string;
export { categorizeTools };
