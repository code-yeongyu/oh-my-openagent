import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { SshTarget } from "./request"

// The closed set of programs enroll runs on a target. The port builds each command itself; nothing a caller passes
// becomes shell text except the API origin, which is a validated https origin quoted as one word.
export type RemoteProgram =
  | { readonly kind: "preflight" }
  | { readonly kind: "install" }
  | { readonly kind: "account_show"; readonly origin: string }
  | { readonly kind: "sign_in_check"; readonly origin: string }
  | { readonly kind: "sign_in"; readonly origin: string }
  | { readonly kind: "doriterm_prerequisites" }
  | { readonly kind: "doriterm_install" }
  | { readonly kind: "doriterm_join" }

/** The one install line of the README. */
export const INSTALL_LINE = "curl -fsSL https://get.omo.dev/install.sh | bash"

const OMO = 'PATH="$HOME/.local/bin:$PATH" omo'
// doriterm's checkout and setup command line, as its own setup skill fixes them (skills/doriterm-setup/SKILL.md).
const DORITERM_SRC = '"$HOME/.local/share/doriface-host/src"'
const DORITERM_SETUP = `bun ${DORITERM_SRC}/apps/host/scripts/setup/cli.ts`
const BUN_PATH = 'export PATH="$HOME/.bun/bin:$PATH"'
const quoteOrigin = (origin: string): string => {
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$|^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error("the API origin is not a plain origin")
  return `'${origin}'`
}

export function remoteCommand(program: RemoteProgram): string {
  switch (program.kind) {
    case "preflight":
      return [
        "uname -s",
        "uname -m",
        `if ${OMO} --version >/dev/null 2>&1; then echo omo:present; else echo omo:absent; fi`,
        'if command -v loginctl >/dev/null 2>&1; then loginctl show-user "$(id -un)" -p Linger 2>/dev/null || echo Linger=unknown; else echo Linger=unknown; fi',
      ].join("; ")
    case "install":
      return INSTALL_LINE
    case "account_show":
      return `OMO_SERVICE_API_URL=${quoteOrigin(program.origin)} ${OMO} account show`
    case "sign_in_check":
      return `OMO_SERVICE_API_URL=${quoteOrigin(program.origin)} ${OMO} account sign-in --check`
    case "sign_in":
      return `OMO_SERVICE_API_URL=${quoteOrigin(program.origin)} ${OMO} account sign-in --stdin`
    case "doriterm_prerequisites":
      return [
        BUN_PATH,
        "if git --version >/dev/null 2>&1; then echo git:present; else echo git:absent; fi",
        "bun --version 2>/dev/null || echo bun:absent",
      ].join("; ")
    case "doriterm_install":
      return [
        BUN_PATH,
        `if [ ! -d ${DORITERM_SRC}/.git ]; then git clone -q https://github.com/sisyphuslabs/doriterm.git ${DORITERM_SRC} && (cd ${DORITERM_SRC} && bun install --frozen-lockfile) || exit 3; fi`,
        `${DORITERM_SETUP} install && ${DORITERM_SETUP} verify`,
      ].join("; ")
    case "doriterm_join":
      // The join link arrives on stdin and lives in an owner-only file that the exit trap removes on every path,
      // so a dropped connection leaves no link behind; the link never appears in argv.
      return [
        BUN_PATH,
        "umask 077",
        'f="$(mktemp "${TMPDIR:-/tmp}/doriterm-join.XXXXXX")" || exit 4',
        "trap 'rm -f \"$f\"' EXIT",
        'cat > "$f"',
        `${DORITERM_SETUP} join --from "$f"`,
      ].join("; ")
  }
}

/** How ssh itself ended, read from its own exit and its own diagnostics, never from the remote program's output. */
export type SshFailure = "unreachable" | "auth_failed" | "host_unverified"

export type SshExit = { readonly code: number | null; readonly sshFailure?: SshFailure }

export type SshSession = {
  /** The remote program's stdout, one line at a time, as it arrives. */
  readonly lines: AsyncIterable<string>
  readonly write: (line: string) => void
  readonly end: () => void
  readonly exit: Promise<SshExit>
}

export type SshPort = {
  readonly open: (program: RemoteProgram, options: { readonly signal?: AbortSignal }) => SshSession
}

const classify = (code: number | null, stderr: string): SshFailure | undefined => {
  if (code !== 255) return undefined
  if (
    /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|No [A-Z0-9-]+ host key is known/.test(stderr)
  )
    return "host_unverified"
  if (/Permission denied|Too many authentication failures/.test(stderr)) return "auth_failed"
  return "unreachable"
}

async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let buffered = ""
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true })
    let newline = buffered.indexOf("\n")
    while (newline !== -1) {
      yield buffered.slice(0, newline).replace(/\r$/, "")
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf("\n")
    }
  }
  if (buffered !== "") yield buffered
}

/**
 * The OpenSSH client over Bun.spawn with an argument array: key or agent authentication only (BatchMode), the host key
 * checked strictly against the caller's known hosts, or against `hostKey` alone in a one-line known-hosts file, and
 * never an option that disables or auto-accepts a host key.
 */
export function openSshPort(target: SshTarget): SshPort {
  return {
    open(program, { signal }) {
      const known = target.hostKey === undefined ? undefined : mkdtemp(join(tmpdir(), "omo-enroll-known-"))
      const knownLine = (dir: string) =>
        `${target.port === undefined || target.port === 22 ? target.host : `[${target.host}]:${target.port}`} ${target.hostKey?.trim()}\n`
      const started = (async () => {
        const dir = known === undefined ? undefined : await known
        if (dir !== undefined) await writeFile(join(dir, "known_hosts"), knownLine(dir), { mode: 0o600 })
        const argv = [
          "ssh",
          "-T",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          "ConnectTimeout=20",
          ...(dir === undefined
            ? []
            : ["-o", `UserKnownHostsFile=${join(dir, "known_hosts")}`, "-o", "GlobalKnownHostsFile=/dev/null"]),
          ...(target.port === undefined ? [] : ["-p", String(target.port)]),
          ...(target.identityFile === undefined ? [] : ["-i", target.identityFile, "-o", "IdentitiesOnly=yes"]),
          ...(target.user === undefined ? [] : ["-l", target.user]),
          "--",
          target.host,
          remoteCommand(program),
        ]
        const child = Bun.spawn(argv, {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
          ...(signal === undefined ? {} : { signal }),
        })
        return { child, dir }
      })()
      const stdoutLines = (async function* () {
        const { child } = await started
        yield* linesOf(child.stdout)
      })()
      const exit = started.then(async ({ child, dir }) => {
        const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
        if (dir !== undefined) await rm(dir, { recursive: true, force: true })
        const sshFailure = classify(code, stderr)
        return sshFailure === undefined ? { code } : { code, sshFailure }
      })
      return {
        lines: stdoutLines,
        write: (line) => {
          void started.then(({ child }) => child.stdin.write(`${line}\n`))
        },
        end: () => {
          void started.then(({ child }) => child.stdin.end())
        },
        exit,
      }
    },
  }
}
