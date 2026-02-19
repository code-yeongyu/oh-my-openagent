import { describe, test, expect, beforeEach } from "bun:test"
import { createHashlineEditDiffEnhancerHook } from "./hook"

function makeInput(tool: string, callID = "call-1", sessionID = "ses-1") {
	return { tool, sessionID, callID }
}

function makeBeforeOutput(args: Record<string, unknown>) {
	return { args }
}

function makeAfterOutput(overrides?: Partial<{ title: string; output: string; metadata: Record<string, unknown> }>) {
	return {
		title: overrides?.title ?? "",
		output: overrides?.output ?? "Successfully applied 1 edit(s)",
		metadata: overrides?.metadata ?? { truncated: false },
	}
}

describe("hashline-edit-diff-enhancer", () => {
	let hook: ReturnType<typeof createHashlineEditDiffEnhancerHook>

	beforeEach(() => {
		hook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: true } })
	})

	describe("tool.execute.before", () => {
		test("captures old file content for edit tool", async () => {
			const filePath = import.meta.dir + "/index.test.ts"
			const input = makeInput("edit")
			const output = makeBeforeOutput({ path: filePath, edits: [] })

			await hook["tool.execute.before"](input, output)

			// given the hook ran without error, the old content should be stored internally
			// we verify in the after hook test that it produces filediff
		})

		test("ignores non-edit tools", async () => {
			const input = makeInput("read")
			const output = makeBeforeOutput({ path: "/some/file.ts" })

			// when - should not throw
			await hook["tool.execute.before"](input, output)
		})
	})

	describe("tool.execute.after", () => {
		test("injects filediff metadata after edit tool execution", async () => {
			// given - a temp file that we can modify between before/after
			const tmpDir = (await import("os")).tmpdir()
			const tmpFile = `${tmpDir}/hashline-diff-test-${Date.now()}.ts`
			const oldContent = "line 1\nline 2\nline 3\n"
			await Bun.write(tmpFile, oldContent)

			const input = makeInput("edit", "call-diff-1")
			const beforeOutput = makeBeforeOutput({ path: tmpFile, edits: [] })

			// when - before hook captures old content
			await hook["tool.execute.before"](input, beforeOutput)

			// when - file is modified (simulating hashline edit execution)
			const newContent = "line 1\nmodified line 2\nline 3\nnew line 4\n"
			await Bun.write(tmpFile, newContent)

			// when - after hook computes filediff
			const afterOutput = makeAfterOutput()
			await hook["tool.execute.after"](input, afterOutput)

			// then - metadata should contain filediff
			const filediff = afterOutput.metadata.filediff as {
				file: string
				path: string
				before: string
				after: string
				additions: number
				deletions: number
			}
			expect(filediff).toBeDefined()
			expect(filediff.file).toBe(tmpFile)
			expect(filediff.path).toBe(tmpFile)
			expect(filediff.before).toBe(oldContent)
			expect(filediff.after).toBe(newContent)
			expect(filediff.additions).toBeGreaterThan(0)
			expect(filediff.deletions).toBeGreaterThan(0)

			// then - title should be set to the file path
			expect(afterOutput.title).toBe(tmpFile)

			// cleanup
			await Bun.file(tmpFile).exists() && (await import("fs/promises")).unlink(tmpFile)
		})

		test("does nothing for non-edit tools", async () => {
			const input = makeInput("read", "call-other")
			const afterOutput = makeAfterOutput()
			const originalMetadata = { ...afterOutput.metadata }

			await hook["tool.execute.after"](input, afterOutput)

			// then - metadata unchanged
			expect(afterOutput.metadata).toEqual(originalMetadata)
		})

		test("does nothing when no before capture exists", async () => {
			// given - no before hook was called for this callID
			const input = makeInput("edit", "call-no-before")
			const afterOutput = makeAfterOutput()
			const originalMetadata = { ...afterOutput.metadata }

			await hook["tool.execute.after"](input, afterOutput)

			// then - metadata unchanged (no filediff injected)
			expect(afterOutput.metadata.filediff).toBeUndefined()
		})

		test("cleans up stored content after consumption", async () => {
			const tmpDir = (await import("os")).tmpdir()
			const tmpFile = `${tmpDir}/hashline-diff-cleanup-${Date.now()}.ts`
			await Bun.write(tmpFile, "original")

			const input = makeInput("edit", "call-cleanup")
			await hook["tool.execute.before"](input, makeBeforeOutput({ path: tmpFile }))
			await Bun.write(tmpFile, "modified")

			// when - first after call consumes
			const afterOutput1 = makeAfterOutput()
			await hook["tool.execute.after"](input, afterOutput1)
			expect(afterOutput1.metadata.filediff).toBeDefined()

			// when - second after call finds nothing
			const afterOutput2 = makeAfterOutput()
			await hook["tool.execute.after"](input, afterOutput2)
			expect(afterOutput2.metadata.filediff).toBeUndefined()

			await (await import("fs/promises")).unlink(tmpFile).catch(() => {})
		})

		test("handles file creation (empty old content)", async () => {
			const tmpDir = (await import("os")).tmpdir()
			const tmpFile = `${tmpDir}/hashline-diff-create-${Date.now()}.ts`

			// given - file doesn't exist during before hook
			const input = makeInput("edit", "call-create")
			await hook["tool.execute.before"](input, makeBeforeOutput({ path: tmpFile }))

			// when - file created during edit
			await Bun.write(tmpFile, "new content\n")

			const afterOutput = makeAfterOutput()
			await hook["tool.execute.after"](input, afterOutput)

			// then - filediff shows creation (before is empty)
			const filediff = afterOutput.metadata.filediff as any
			expect(filediff).toBeDefined()
			expect(filediff.before).toBe("")
			expect(filediff.after).toBe("new content\n")
			expect(filediff.additions).toBeGreaterThan(0)
			expect(filediff.deletions).toBe(0)

			await (await import("fs/promises")).unlink(tmpFile).catch(() => {})
		})
	})

	describe("disabled config", () => {
		test("does nothing when hashline_edit is disabled", async () => {
			const disabledHook = createHashlineEditDiffEnhancerHook({ hashline_edit: { enabled: false } })
			const tmpDir = (await import("os")).tmpdir()
			const tmpFile = `${tmpDir}/hashline-diff-disabled-${Date.now()}.ts`
			await Bun.write(tmpFile, "content")

			const input = makeInput("edit", "call-disabled")
			await disabledHook["tool.execute.before"](input, makeBeforeOutput({ path: tmpFile }))
			await Bun.write(tmpFile, "modified")

			const afterOutput = makeAfterOutput()
			await disabledHook["tool.execute.after"](input, afterOutput)

			// then - no filediff injected
			expect(afterOutput.metadata.filediff).toBeUndefined()

			await (await import("fs/promises")).unlink(tmpFile).catch(() => {})
		})
	})
})
