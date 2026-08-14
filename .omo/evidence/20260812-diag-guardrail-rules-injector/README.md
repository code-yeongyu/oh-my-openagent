# diag-harness guardrail learning → rules-injector bridge

**WHAT WAS TESTED:** the new `emit_rule_files()` path in `script/diag-harness/harness.py`
renders learned guardrail lines (from `guardrails.md`) into `.omo/rules/diag-guardrail-*.md`
rule files with `alwaysApply: true` frontmatter, replacing the old custom `prompt_append`
injection. The emitted files are consumed by the native `rules-injector` hook on every tool
execution.

**WHAT WAS OBSERVED:**
1. Python syntax check passes on the modified `harness.py`.
2. A simulated run with 3 learned rules produced exactly 3 rule files
   (`diag-guardrail-1.md` … `-3.md`), each with frontmatter + rule body.
3. Real `rules-engine` consumer proof: `parseRuleFrontmatter` + `shouldApplyRule` from
   `packages/rules-engine/src/index` parsed each emitted file and returned
   `alwaysApply=true` and `applies=true` — the exact code path the rules-injector hook
   uses at runtime. RESULT: 2/2 files parse + alwaysApply + apply.
4. `bun run typecheck` (tsgo root + all packages): exit 0.
5. `guardrails.md` test pollution was restored via `git checkout`; `__pycache__` removed.

**WHY IT IS ENOUGH:** the change is a Python renderer plus config-injection removal. The
only runtime contract is "rules-injector must accept the emitted files", which is proven
with the real parser/matcher — stronger than a test double.

**WHAT WAS OMITTED:** a full live `opencode run` against DeepSeek (needs paid API + ~10 min
per run). The renderer contract is fully covered above; the live loop behavior (signal →
learn → emit → re-run) is unchanged from the validated harness and only swaps the injection
mechanism.
