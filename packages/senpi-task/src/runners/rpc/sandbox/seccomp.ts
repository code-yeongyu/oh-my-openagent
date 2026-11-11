import { writeFileSync } from "node:fs"
import { join } from "node:path"

const LD_W_ABS = 0x20
const JEQ_K = 0x15
const JGE_K = 0x35
const RET_K = 0x06
const RET_ALLOW = 0x7fff0000
const RET_KILL_PROCESS = 0x80000000
const RET_EPERM = 0x00050001
const AF_UNIX = 1
const X32_SYSCALL_BIT = 0x40000000
const SECCOMP_DATA_NR = 0
const SECCOMP_DATA_ARCH = 4
const SECCOMP_DATA_ARG0_LOW = 16

const ARCHES = {
  x64: { audit: 0xc000003e, socket: 41 },
  arm64: { audit: 0xc00000b7, socket: 198 },
} as const

/**
 * The Linux filter bwrap installs on the child (senpi#6287): socket(AF_UNIX, ...) fails with EPERM,
 * so the child cannot reach the RPC daemon, the LSP daemon, D-Bus, tmux or any other same-user socket,
 * filesystem or abstract. socketpair() and inet sockets stay allowed. A syscall from another ABI (x32,
 * a foreign architecture) kills the process, since it could create a socket the filter never sees.
 */
export function unixSocketFilter(arch: string): Buffer | undefined {
  const target = arch === "x64" || arch === "arm64" ? ARCHES[arch] : undefined
  if (target === undefined) return undefined
  const program = [
    instruction(LD_W_ABS, 0, 0, SECCOMP_DATA_ARCH),
    instruction(JEQ_K, 1, 0, target.audit),
    instruction(RET_K, 0, 0, RET_KILL_PROCESS),
    instruction(LD_W_ABS, 0, 0, SECCOMP_DATA_NR),
    instruction(JGE_K, 0, 1, X32_SYSCALL_BIT),
    instruction(RET_K, 0, 0, RET_KILL_PROCESS),
    instruction(JEQ_K, 0, 3, target.socket),
    instruction(LD_W_ABS, 0, 0, SECCOMP_DATA_ARG0_LOW),
    instruction(JEQ_K, 0, 1, AF_UNIX),
    instruction(RET_K, 0, 0, RET_EPERM),
    instruction(RET_K, 0, 0, RET_ALLOW),
  ]
  return Buffer.concat(program)
}

export function writeUnixSocketFilter(dir: string, arch: string = process.arch): string | undefined {
  const filter = unixSocketFilter(arch)
  if (filter === undefined) return undefined
  const path = join(dir, "unix-socket.bpf")
  writeFileSync(path, filter, { mode: 0o600 })
  return path
}

function instruction(code: number, jt: number, jf: number, k: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt16LE(code, 0)
  buffer.writeUInt8(jt, 2)
  buffer.writeUInt8(jf, 3)
  buffer.writeUInt32LE(k >>> 0, 4)
  return buffer
}
