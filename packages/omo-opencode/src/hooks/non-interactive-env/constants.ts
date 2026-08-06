export const HOOK_NAME = "non-interactive-env"

export const NON_INTERACTIVE_ENV: Record<string, string> = {
  CI: "true",
  DEBIAN_FRONTEND: "noninteractive",
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  HOMEBREW_NO_AUTO_UPDATE: "1",
  // Block interactive editors - git rebase, commit, etc.
  GIT_EDITOR: ":",
  EDITOR: ":",
  VISUAL: "",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_MERGE_AUTOEDIT: "no",
  // Block pagers
  GIT_PAGER: "cat",
  PAGER: "cat",
  // NPM non-interactive
  npm_config_yes: "true",
  // Pip non-interactive
  PIP_NO_INPUT: "1",
  // Yarn non-interactive
  YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
}

/**
 * Shell command guidance for non-interactive environments.
 * These patterns should be followed to avoid hanging on user input.
 */
export const SHELL_COMMAND_PATTERNS = {
  // Package managers - always use non-interactive flags
  npm: {
    bad: ["npm init", "npm install (prompts)"],
    good: ["npm init -y", "npm install --yes"],
  },
  apt: {
    bad: ["apt-get install pkg"],
    good: ["apt-get install -y pkg", "DEBIAN_FRONTEND=noninteractive apt-get install pkg"],
  },
  pip: {
    bad: ["pip install pkg (with prompts)"],
    good: ["pip install --no-input pkg", "PIP_NO_INPUT=1 pip install pkg"],
  },
  // Git operations - always provide messages/flags
  git: {
    bad: ["git commit", "git merge branch", "git add -p", "git rebase -i"],
    good: ["git commit -m 'msg'", "git merge --no-edit branch", "git add .", "git rebase --no-edit"],
  },
  // System commands - force flags
  system: {
    bad: ["rm file (prompts)", "cp a b (prompts)", "ssh host"],
    good: ["rm -f file", "cp -f a b", "ssh -o BatchMode=yes host", "unzip -o file.zip"],
  },
  // Banned commands - will always hang
  banned: [
    "vim", "nano", "vi", "emacs",           // Editors
    "less", "more", "man",                   // Pagers
    "python (REPL)", "node (REPL)",          // REPLs without -c/-e
    "git add -p", "git rebase -i",           // Interactive git modes
  ],
  // Workarounds for scripts that require input
  workarounds: {
    yesPipe: "yes | ./script.sh",
    heredoc: `./script.sh <<EOF
option1
option2
EOF`,
    expectAlternative: "Use environment variables or config files instead of expect",
  },
} as const
