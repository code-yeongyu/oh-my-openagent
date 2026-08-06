export const CODEX_COMPONENT_NOTICE_REQUIREMENTS = [
  {
    path: "packages/omo-codex/plugin/components/codegraph",
    requiredFiles: ["LICENSE", "NOTICE", "NODE-RUNTIME-LICENSES.md"],
    requiredTerms: ["@colbymchenry/codegraph", "Node.js v24.16.0 runtime", "NODE-RUNTIME-LICENSES.md", "MIT license"],
    forbiddenTerms: ["packages/omo-codex/THIRD-PARTY-NOTICES.md"],
  },
  {
    path: "packages/omo-codex/plugin/components/comment-checker",
    requiredTerms: ["pi-comment-checker", "@code-yeongyu/comment-checker"],
  },
  {
    path: "packages/omo-codex/plugin/components/lsp",
    requiredTerms: ["pi-lsp-client"],
  },
  {
    path: "packages/omo-codex/plugin/components/rules",
    requiredTerms: ["pi-rules", "picomatch"],
  },
  {
    path: "packages/omo-codex/plugin/components/start-work-continuation",
    requiredTerms: [],
  },
  {
    path: "packages/omo-codex/plugin/components/telemetry",
    requiredTerms: ["posthog-node", "@oh-my-opencode/telemetry-core"],
  },
  {
    path: "packages/omo-codex/plugin/components/ultrawork",
    requiredTerms: [],
  },
  {
    path: "packages/omo-codex/plugin/components/ulw-loop",
    requiredTerms: [],
  },
]
