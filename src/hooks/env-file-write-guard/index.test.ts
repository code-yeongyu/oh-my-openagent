import { describe, expect, test } from "bun:test"
import { createEnvFileWriteGuardHook } from "./index"

describe("createEnvFileWriteGuardHook", () => {
  describe("tool.execute.before", () => {
    test("blocks write to .env file", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: ".env", content: "API_KEY=secret" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("blocks write to .env.local file", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "config/.env.local", content: "SECRET=xyz" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("blocks write to .pem file", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "certs/server.pem", content: "-----BEGIN" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("blocks write to .key file", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "private.key", content: "key data" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("blocks write to credentials.json", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "edit", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "credentials.json", oldString: "a", newString: "b" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("blocks write to id_rsa", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "~/.ssh/id_rsa", content: "key" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("allows write to regular .ts file", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: "src/index.ts", content: "code" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("allows write to .env.example", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook({
        enabled: true,
        blocked_patterns: [".env", ".env.local", ".env.production"],
      })
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: ".env.example", content: "KEY=placeholder" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("ignores non-write/edit tools", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "bash", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { command: "cat .env" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("respects allowed_paths override", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook({
        enabled: true,
        blocked_patterns: [".env", ".env.*"],
        allowed_paths: [".env.example"],
      })
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: ".env.example", content: "PLACEHOLDER=value" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("does nothing when disabled", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook({ enabled: false })
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: ".env", content: "SECRET=value" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).resolves.toBeUndefined()
    })

    test("blocks multiedit tool on sensitive files", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "MultiEdit", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { filePath: ".npmrc", edits: [] } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("handles file_path arg variant", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { file_path: ".env", content: "SECRET=abc" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })

    test("handles path arg variant", async () => {
      //#given
      const hook = createEnvFileWriteGuardHook()
      const input = { tool: "Write", sessionID: "ses_1", callID: "call_1" }
      const output = { args: { path: "service-account-prod.json", content: "{}" } }

      //#when
      const result = hook["tool.execute.before"]?.(input as any, output as any)

      //#then
      await expect(result).rejects.toThrow("SENSITIVE FILE GUARD")
    })
  })
})
