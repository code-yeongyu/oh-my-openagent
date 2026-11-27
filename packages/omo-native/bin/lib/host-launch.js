import { existsSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { LAUNCH_SPEC_FILENAME } from "./launch-spec-mode.js"

/** Only the engine arguments before `--` belong to the launcher. */
export function withProductLaunchSpec(args, pluginRoot) {
  const end = args.indexOf("--")
  const options = end === -1 ? args : args.slice(0, end)
  if (options[0] !== "host") return args
  const startsHost =
    options[1] === "ensure" || options[1] === "handoff" || (options[1] === "session" && options[2] === "open")
  if (!startsHost || options.some((arg) => arg === "--launch-spec" || arg.startsWith("--launch-spec="))) return args
  const spec = join(pluginRoot, LAUNCH_SPEC_FILENAME)
  if (options[1] === "session" && !existsSync(spec)) return args
  return [...options, "--launch-spec", spec, ...args.slice(options.length)]
}

export function productPluginState(profile, pluginRoot) {
  const extensions = profile?.core?.extensions
  if (!Array.isArray(extensions) || !extensions.every((path) => typeof path === "string")) return "unknown"
  // A primary can outlive its installation. Recognize an earlier product root by its member sibling,
  // never just because an unrelated extension directory happens to be named "plugin".
  return extensions.some(
    (path) =>
      path === pluginRoot ||
      (basename(path) === "plugin" && extensions.includes(join(path, "extensions", "omo-member.js"))),
  )
    ? "loaded"
    : "absent"
}

export function operatorHostLaunch(args, agentDir, env = process.env) {
  if (args[0] !== "host" || !["ensure", "handoff"].includes(args[1])) return false
  const index = args.indexOf("--socket")
  const socket = index === -1 ? (env.OMO_RPC_SOCKET ?? env.SENPI_RPC_SOCKET ?? env.PI_RPC_SOCKET) : args[index + 1]
  return socket === undefined || resolve(socket) === join(agentDir, "rpc", "rpc.sock")
}

export async function observedLaunch(result, { args, agentDir, pluginRoot, observe, budgetMs = 2000 }) {
  if (result.exitCode !== 0) return result
  let payload
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    return result
  }
  if (typeof payload?.socket !== "string" || !["start", "handoff", "reuse"].includes(payload.action)) return result
  const key = args.indexOf("--rpc-key-root")
  const keyRoot = key < 0 ? agentDir : args[key + 1]
  const profile = await observe(payload.socket, budgetMs, { keyRoot }).catch(() => undefined)
  const productPlugin = productPluginState(profile?.launch_profile, pluginRoot)
  const absent = productPlugin === "absent"
  const detail = absent
    ? "A live primary without the product plugin is serving. Sessions created on it have no thread tools. Use omo host handoff when its sessions are idle; omo daemon run may reuse the live primary."
    : productPlugin === "unknown"
      ? "The serving host's launch profile was not observed."
      : undefined
  return {
    ...result,
    exitCode: absent ? 3 : result.exitCode,
    stdout: `${JSON.stringify({ ...payload, productPlugin, ...(absent && { engineAction: payload.action, action: "refuse", reason: "primary_without_product_plugin" }), ...(detail && { detail }) })}\n`,
  }
}
