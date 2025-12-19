export const HOOK_NAME = "non-interactive-env"

export const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  HOMEBREW_NO_AUTO_UPDATE: "1",
  // Block interactive editors - git rebase, commit, etc.
  GIT_EDITOR: "true",
  EDITOR: "true",
  VISUAL: "true",
  GIT_SEQUENCE_EDITOR: "true",
  // Block pagers
  GIT_PAGER: "cat",
  PAGER: "cat",
}
