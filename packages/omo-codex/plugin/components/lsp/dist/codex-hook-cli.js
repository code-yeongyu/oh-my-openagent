import { stdin as processStdin } from "node:process";
import { isRecord, runLspPostCompactHook, runLspPostToolUseHook } from "./codex-hook.js";
export async function runPostToolUseHookCli(stdin = processStdin) {
    await runHookCli((input) => runLspPostToolUseHook(input), stdin);
}
export async function runPostCompactHookCli(stdin = processStdin) {
    await runHookCli((input) => runLspPostCompactHook(input), stdin);
}
async function runHookCli(runHook, stdin) {
    try {
        const raw = await readStdin(stdin);
        if (!raw.trim())
            return;
        const parsed = JSON.parse(raw);
        const input = isRecord(parsed) ? parsed : {};
        const output = await runHook(input);
        if (output)
            process.stdout.write(output);
    }
    catch {
        // LSP feedback is best-effort: stderr or a non-zero exit here surfaces as harness noise on every edit.
        return;
    }
}
async function readStdin(stdin) {
    stdin.setEncoding("utf8");
    let raw = "";
    for await (const chunk of stdin) {
        raw += chunk;
    }
    return raw;
}
