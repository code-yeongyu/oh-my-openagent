import { shellSegments } from "./shell-words"

export type InvokedKind = "test" | "typecheck" | "lint" | "build" | "run" | "lookup"

const MAX_DEPTH = 3
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const SLOT_WRAPPERS = /(?:^|\/)(?:heavy-slot|early-static-slot|launch-detached)\.sh$/
const SHELLS = new Set(["bash", "sh", "zsh"])
const SHELL_KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{", "}"])
const PASSTHROUGH = new Set(["env", "time", "nohup", "command", "exec", "sudo"])
// Wrapper options that take a value (`env -u NAME`, `sudo -u user`, `time -o file`), per env(1), sudo(8) and time(1).
const WRAPPER_VALUE_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = {
  env: new Set(["-u", "-C", "-P"]),
  sudo: new Set(["-u", "-g", "-h", "-p", "-c", "-C", "-D", "-r", "-R", "-t", "-U", "-T"]),
  time: new Set(["-f", "-o"]),
}
const PYTHON_RUNNERS = new Set(["uv", "poetry", "pdm", "pipx", "hatch", "rye"])
const PYTHONS = /^python(?:3(?:\.\d+)?)?$/
const TASK_RUNNERS = new Set(["make", "just", "task"])
const QA_SCRIPT = /(?:^|\/)scripts\/qa\//
const RUNNERS = new Set(["bun", "npm", "pnpm", "yarn"])
const PACKAGE_EXEC = new Set(["bunx", "npx", "pnpx"])
const LOOKUP_TOOLS = new Set(["rg", "grep", "egrep", "cat", "head", "tail", "ls", "find", "fd", "sg", "ast-grep"])
// ssh options that take a value (`-o BatchMode=yes`, `-p 22`, ...), per ssh(1).
const SSH_VALUE_FLAGS = new Set("BbcDEeFIiJLlmOoPpQRSWw".split(""))
const CI_API_PATH = /check-runs|check-suites|\/status(?:es)?\b/

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

function skipFlags(argv: readonly string[], from: number, valueFlags?: ReadonlySet<string>): readonly string[] {
  let index = from
  while (index < argv.length && (argv[index] as string).startsWith("-")) index += valueFlags?.has(argv[index] as string) ? 2 : 1
  return argv.slice(index)
}

function skipTimeout(argv: readonly string[]): readonly string[] {
  let index = 1
  while (index < argv.length && (argv[index] as string).startsWith("-")) {
    const flag = argv[index] as string
    index += flag === "-k" || flag === "-s" || flag === "--kill-after" || flag === "--signal" ? 2 : 1
  }
  return argv.slice(index + 1)
}

// The remote command of `ssh [options] host command...`: ssh joins the remaining words with spaces.
function sshRemoteCommand(argv: readonly string[]): string | undefined {
  let index = 1
  while (index < argv.length && (argv[index] as string).startsWith("-")) {
    const flag = argv[index] as string
    index += flag.length === 2 && SSH_VALUE_FLAGS.has(flag.slice(1)) ? 2 : 1
  }
  const remote = argv.slice(argv[index + 1] === "--" ? index + 2 : index + 1)
  return remote.length === 0 ? undefined : remote.join(" ")
}

function scriptKind(script: string): InvokedKind | undefined {
  if (/^test(?::|$)/.test(script)) return "test"
  if (/^(?:typecheck|type-check)(?::|$)/.test(script)) return "typecheck"
  if (/^lint(?::|$)/.test(script)) return "lint"
  if (/^build(?::|$)/.test(script)) return "build"
  return undefined
}

const scriptKinds = (scripts: readonly string[]): InvokedKind[] =>
  scripts.flatMap((script) => {
    const kind = scriptKind(script)
    return kind ? [kind] : []
  })

// GitHub CI readouts (`gh pr checks`, run views, check-run APIs) are test receipts for claims about CI.
function githubKinds(rest: readonly string[]): InvokedKind[] {
  const [first = "", second = ""] = rest
  if (first === "pr" && second === "checks") return ["test"]
  if (first === "pr" && second === "view" && rest.some((arg) => arg.includes("statusCheckRollup"))) return ["test"]
  if (first === "run" && (second === "view" || second === "watch")) return ["test"]
  if (first === "api" && rest.some((arg) => CI_API_PATH.test(arg))) return ["test"]
  return []
}

function toolKinds(exe: string, rest: readonly string[]): InvokedKind[] {
  const [first = "", second = ""] = rest
  if ((exe === "bun" || exe === "node" || exe === "tsx") && rest.some((arg) => QA_SCRIPT.test(arg))) return ["run"]
  if (TASK_RUNNERS.has(exe)) return scriptKinds(skipFlags(rest, 0)).slice(0, 1)
  if (exe === "vitest" || exe === "jest" || exe === "pytest") return ["test"]
  if (exe === "playwright" && first === "test") return ["test"]
  if (exe === "tsc" || exe === "tsgo" || exe === "mypy" || exe === "pyright") return ["typecheck"]
  if (exe === "eslint" || exe === "oxlint" || exe === "ruff") return ["lint"]
  if (exe === "biome" && ["check", "lint", "ci"].includes(first)) return ["lint"]
  if (exe === "cargo") {
    if (first === "test") return ["test"]
    if (first === "check") return ["typecheck"]
    if (first === "clippy") return ["lint"]
    if (first === "build") return ["build"]
  }
  if (exe === "go" && (first === "test" || first === "build")) return [first === "test" ? "test" : "build"]
  if (exe === "deno" && first === "test") return ["test"]
  if ((exe === "vite" || exe === "next") && first === "build") return ["build"]
  if (exe === "gh") return githubKinds(rest)
  if (exe === "vp") {
    if (first === "test") return ["test"]
    if (first === "check") return ["typecheck", "lint"]
    if (first === "lint") return ["lint"]
    if (first === "run") return scriptKinds(rest.slice(1))
  }
  if (RUNNERS.has(exe)) {
    if (exe === "bun" && first === "test") return ["test"]
    if (exe === "bun" && first === "build") return ["build"]
    if (first === "run") return scriptKinds([second])
    if (exe !== "bun" && first === "test") return ["test"]
  }
  if (LOOKUP_TOOLS.has(exe)) return ["lookup"]
  if (exe === "git" && (first === "grep" || first === "show")) return ["lookup"]
  return []
}

function wrappedKinds(exe: string, rest: readonly string[], depth: number): InvokedKind[] | undefined {
  if (exe === "env" && rest.includes("-S")) {
    const split = rest.indexOf("-S")
    return depth >= MAX_DEPTH ? [] : invokedKinds(rest.slice(split + 1).join(" "), depth + 1)
  }
  if (PASSTHROUGH.has(exe)) return argvKinds(skipFlags(rest, 1, WRAPPER_VALUE_FLAGS[exe]), depth)
  if (PYTHON_RUNNERS.has(exe) && rest[1] === "run") return argvKinds(skipFlags(rest, 2), depth)
  if (PYTHONS.test(exe)) {
    const module = rest.indexOf("-m")
    if (module !== -1) return argvKinds(rest.slice(module + 1), depth)
    return rest.some((arg) => QA_SCRIPT.test(arg)) ? ["run"] : []
  }
  if (exe === "timeout") return argvKinds(skipTimeout(rest), depth)
  if (exe === "nice") return argvKinds(rest[1] === "-n" ? rest.slice(3) : rest.slice(1), depth)
  if (SLOT_WRAPPERS.test(rest[0] as string)) {
    const separator = rest.indexOf("--")
    return separator === -1 ? [] : argvKinds(rest.slice(separator + 1), depth)
  }
  if (exe === "ssh") {
    const remote = sshRemoteCommand(rest)
    return remote === undefined || depth >= MAX_DEPTH ? [] : invokedKinds(remote, depth + 1)
  }
  if (SHELLS.has(exe)) {
    const flagIndex = rest.findIndex((arg, index) => index > 0 && /^-[a-z]*c$/.test(arg))
    if (flagIndex === -1) return skipFlags(rest, 1).slice(0, 1).some((arg) => QA_SCRIPT.test(arg)) ? ["run"] : []
    const script = rest[flagIndex + 1]
    return script === undefined || depth >= MAX_DEPTH ? [] : invokedKinds(script, depth + 1)
  }
  if (PACKAGE_EXEC.has(exe)) return argvKinds(rest.slice(1).filter((arg) => !arg.startsWith("-")), depth)
  if (exe === "bun" && rest[1] === "x") return argvKinds(rest.slice(2), depth)
  if (exe === "pnpm" && rest[1] === "exec") return argvKinds(rest.slice(2), depth)
  return undefined
}

function argvKinds(argv: readonly string[], depth: number): InvokedKind[] {
  let rest = argv
  while (rest.length > 0 && (ASSIGNMENT.test(rest[0] as string) || SHELL_KEYWORDS.has(rest[0] as string))) rest = rest.slice(1)
  if (rest.length === 0) return []
  if (QA_SCRIPT.test(rest[0] as string)) return ["run"]
  const exe = basename(rest[0] as string)
  return wrappedKinds(exe, rest, depth) ?? toolKinds(exe, rest.slice(1))
}

/** Kinds of checks a shell command line actually invokes: the executable and its subcommand decide, never a mention. */
export function invokedKinds(line: string, depth = 0): InvokedKind[] {
  const kinds: InvokedKind[] = []
  for (const argv of shellSegments(line)) for (const kind of argvKinds(argv, depth)) if (!kinds.includes(kind)) kinds.push(kind)
  return kinds
}
