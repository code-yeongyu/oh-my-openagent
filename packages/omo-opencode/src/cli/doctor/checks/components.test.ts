import { describe, expect, it } from "bun:test"
import type { LspLanguageReport } from "@oh-my-opencode/lsp-core/lsp/component-check"

import type { ComponentsReport, ToolComponentReport } from "../framework/types"
import { buildComponentIssues, summarizeComponents } from "./components"

function language(overrides: Partial<LspLanguageReport>): LspLanguageReport {
  return {
    language: "typescript",
    extension: ".ts",
    required: false,
    projectFiles: 3,
    status: "ok",
    serverId: "typescript",
    executable: "/usr/bin/typescript-language-server",
    probe: null,
    detail: "",
    remediation: [],
    ...overrides,
  }
}

function tool(overrides: Partial<ToolComponentReport> & Pick<ToolComponentReport, "id">): ToolComponentReport {
  return { status: "ok", path: null, version: null, detail: "", remediation: [], ...overrides }
}

function report(languages: LspLanguageReport[], tools: ToolComponentReport[] = [], requiredLanguages: string[] = []): ComponentsReport {
  return { cwd: "/project", probed: true, requiredLanguages, lsp: { cwd: "/project", scannedEntries: 10, languages }, tools }
}

describe("buildComponentIssues", () => {
  it("#given a required language that is missing #when building issues #then it is an error with remediation", () => {
    // given
    const missing = language({ language: "shellscript", extension: ".sh", required: true, status: "missing", serverId: "bash", remediation: ["npm install -g bash-language-server"] })

    // when
    const issues = buildComponentIssues(report([missing]))

    // then
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe("error")
    expect(issues[0]?.fix).toContain("bash-language-server")
  })

  it("#given an optional used language whose server times out #when building issues #then it is only a warning", () => {
    // when
    const issues = buildComponentIssues(report([language({ status: "timeout" })]))

    // then
    expect(issues.map((issue) => issue.severity)).toEqual(["warning"])
  })

  it("#given an optional language nothing handles #when building issues #then it is not reported", () => {
    // when
    const issues = buildComponentIssues(report([language({ language: "markdown", extension: ".md", status: "unconfigured", serverId: null })]))

    // then
    expect(issues).toEqual([])
  })

  it("#given a failed tool and a skipped one #when building issues #then only the failed tool is a warning", () => {
    // given
    const tools = [tool({ id: "ast-grep", status: "failed", detail: "sg did not match" }), tool({ id: "comment-checker", status: "skipped" })]

    // when
    const issues = buildComponentIssues(report([], tools))

    // then
    expect(issues.map((issue) => issue.title)).toEqual(["ast-grep: failed"])
  })

  it("#given the LSP tools disabled and required languages #when building issues #then it is an error", () => {
    // given
    const disabled: ComponentsReport = { cwd: "/p", probed: true, requiredLanguages: ["typescript"], lsp: null, tools: [] }

    // when
    const issues = buildComponentIssues(disabled)

    // then
    expect(issues[0]?.title).toBe("LSP tools disabled")
    expect(issues[0]?.severity).toBe("error")
  })
})

describe("summarizeComponents", () => {
  it("#given languages and tools #when summarizing #then each gets one line naming its server and status", () => {
    // when
    const lines = summarizeComponents(report([language({ required: true })], [tool({ id: "lsp-bridge", status: "present" })]))

    // then
    expect(lines).toEqual(["LSP typescript (required): ok via typescript", "lsp-bridge: present"])
  })
})
