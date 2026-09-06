// Renders the omo-opencode / prompts-core surfaces touched by the async-first sweep through their REAL
// builders and writes them to --out; prints PASS/FAIL per expected/forbidden phrase.
// bun render-dump.ts --repo <omo checkout> --out <dir>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const get = (flag: string) => argv[argv.indexOf(flag) + 1];
const repo = get("--repo");
const out = get("--out");
mkdirSync(out, { recursive: true });

const results: string[] = [];
const check = (name: string, text: string, expects: string[], forbids: string[]) => {
	writeFileSync(join(out, `${name}.md`), text);
	for (const e of expects) results.push(`${name} expects ${JSON.stringify(e)}: ${text.includes(e) ? "PASS" : "FAIL"}`);
	for (const f of forbids) results.push(`${name} forbids ${JSON.stringify(f)}: ${text.includes(f) ? "FAIL" : "PASS"}`);
	results.push(`${name} chars=${text.length}`);
};

const sis = await import(join(repo, "packages/omo-opencode/src/agents/sisyphus/gpt-5-5.ts"));
const sisPrompt: string = sis.buildGpt55SisyphusPrompt("openai/gpt-6-astra", [], [], [], [{ name: "quick", description: "Trivial tasks", model: "x" }], false);
check("sisyphus-gpt-5-5", sisPrompt, ["`true` is the standard spawn", "Run it in the background and continue", "run_in_background=true,"], ["`false` for synchronous work where the next step depends", "Synchronous (`run_in_background=false`)", "run_in_background=false,\n  prompt"]);

const jr = await import(join(repo, "packages/omo-opencode/src/agents/sisyphus-junior/gpt-5-5.ts"));
const jrPrompt: string = jr.buildGpt55SisyphusJuniorPrompt(false, undefined, "openai/gpt-6-astra");
check("sisyphus-junior-gpt-5-5", jrPrompt, ["Run it in the background; continue"], ["`run_in_background=false` when their answer blocks"]);

const pres = await import(join(repo, "packages/omo-opencode/src/tools/delegate-task/tool-description.ts"));
const desc: string = pres.createDelegateTaskPresentation({ userCategories: {} }).description;
check("delegate-task-description", desc, ["true is the standard spawn", "run_in_background=true)"], ["ONLY for parallel exploration", "Defaults to false (sync, waits)", "run_in_background=false, prompt=\"Task 1"]);

try {
	const tools = await import(join(repo, "packages/omo-opencode/src/tools/delegate-task/tools.ts"));
	const def = tools.createDelegateTask({ userCategories: {} } as never);
	const schemaDesc: string = def.args?.run_in_background?.description ?? def.args?.run_in_background?._def?.description ?? JSON.stringify(def.args?.run_in_background ?? null);
	check("delegate-task-schema-run_in_background", String(schemaDesc), ["true is the standard spawn", "Omitted counts as false"], ["Use true ONLY for parallel exploration"]);
} catch (error) {
	results.push(`delegate-task-schema-run_in_background: could not build tool (${String(error).slice(0, 160)})`);
}

const atlas = await import(join(repo, "packages/prompts-core/src/atlas-prompts.ts"));
const atlasGpt: string = String(atlas.atlasPromptVariants.gpt?.content ?? "");
check("atlas-gpt", atlasGpt, ["the completion notification wakes you to verify", "run_in_background=true, prompt=\"...task A...\""], ["blocks for verification", "run_in_background=false"]);

const ulw = await import(join(repo, "packages/prompts-core/src/ultrawork-prompts.ts"));
check("ultrawork-gpt", String(ulw.ULTRAWORK_GPT_PROMPT), ["subagent_type=\"oracle\", load_skills=[], run_in_background=true"], ["run_in_background=false"]);

const retry = await import(join(repo, "packages/delegate-core/src/retry-patterns.ts"));
const hint = retry.DELEGATE_TASK_ERROR_PATTERNS.find((p: { errorType: string }) => p.errorType === "missing_run_in_background")?.fixHint ?? "";
check("retry-fix-hint", hint, ["run_in_background=true (the standard spawn)"], ["run_in_background=false (for delegation)"]);

const resume = await import(join(repo, "packages/omo-opencode/src/hooks/task-resume-info/hook.ts"));
results.push(`task-resume-info exports: ${Object.keys(resume).join(",")}`);

writeFileSync(join(out, "render-check.txt"), `${results.join("\n")}\n`);
console.log(results.join("\n"));
