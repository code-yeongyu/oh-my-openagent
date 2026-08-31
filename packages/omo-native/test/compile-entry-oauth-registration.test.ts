import { expect, test } from "bun:test"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

test("#given a sentinel bundled OAuth loader #when compile-entry loads #then it registers the real nested OpenAI Codex flow", async () => {
  // given / when
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
        const oauthRoot = "./node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist";
        const { registerBundledOAuthFlowLoaders, loadOpenAICodexOAuth } = await import(oauthRoot + "/auth/oauth/load.js");
        const { openaiCodexOAuth } = await import(oauthRoot + "/auth/oauth/openai-codex.js");
        const sentinel = {};
        registerBundledOAuthFlowLoaders({
          anthropic: () => sentinel,
          openaiCodex: () => sentinel,
          githubCopilot: () => sentinel,
          openrouter: () => sentinel,
          kimiCoding: () => sentinel,
          xai: () => sentinel,
          cursor: () => sentinel,
          radius: () => sentinel,
        });
        await import("./packages/omo-native/compile-entry.ts");
        if (await loadOpenAICodexOAuth() !== openaiCodexOAuth) throw new Error("compile-entry did not replace the sentinel OAuth loader");
        process.stdout.write("registered");
      `,
    ],
    { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])

  // then
  expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "registered", stderr: "" })
})
