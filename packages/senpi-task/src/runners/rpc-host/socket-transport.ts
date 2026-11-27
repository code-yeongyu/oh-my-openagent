import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { win32 } from "node:path"

const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
const WINDOWS_SECRET_BYTES = 32

/**
 * Where a host endpoint is dialed: the socket path itself on POSIX; on Windows the named pipe derived from the endpoint
 * and its secret file, plus the secret the client writes first. Undefined when no usable secret file is there.
 */
export async function resolveRpcSocketTransport(
  endpoint: string,
): Promise<{ readonly address: string; readonly secret?: Buffer } | undefined> {
  if (process.platform !== "win32") return { address: endpoint }
  let secret: Buffer
  try {
    secret = await readFile(`${endpoint}.secret`)
  } catch {
    return undefined
  }
  if (secret.length !== WINDOWS_SECRET_BYTES) return undefined
  const canonical = win32.normalize(endpoint).toLowerCase()
  const name = createHash("sha256")
    .update(Buffer.concat([Buffer.from(canonical, "utf8"), secret]))
    .digest("hex")
    .slice(0, 32)
  return { address: `${WINDOWS_PIPE_PREFIX}${name}`, secret }
}
