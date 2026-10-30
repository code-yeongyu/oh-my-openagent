import installPs1 from "../scripts/install.ps1"
import installSh from "../scripts/install.sh"
import { isQaInstall, recordDownload, requestCountry } from "./datapoint"
import type { RequestContext } from "./env"

const SCRIPT_TTL_SECONDS = 300
const DOCS_URL = "https://omo.dev/docs/install"
const SCRIPTS = { "install.sh": installSh, "install.ps1": installPs1 } as const
export type ScriptName = keyof typeof SCRIPTS

export function isScriptName(value: string): value is ScriptName {
  return value in SCRIPTS
}

export function serveScript(request: Request, ctx: RequestContext, name: ScriptName): Response {
  if (request.method === "GET") {
    recordDownload(ctx.env, { kind: "script", source: "worker", version: "", asset: name, country: requestCountry(request), qa: isQaInstall(request) })
  }
  return new Response(request.method === "HEAD" ? null : SCRIPTS[name], {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": `public, max-age=${SCRIPT_TTL_SECONDS}`,
      "X-Content-Type-Options": "nosniff",
    },
  })
}

// `curl get.omo.dev | bash` and `irm get.omo.dev | iex` land on "/"; a browser gets the docs page.
export function scriptForRoot(request: Request): ScriptName | null {
  const agent = request.headers.get("User-Agent") ?? ""
  if (/PowerShell/i.test(agent)) return "install.ps1"
  if (/^(curl|Wget|fetch|HTTPie)\//i.test(agent)) return "install.sh"
  return null
}

export function docsRedirect(): Response {
  return new Response(null, { status: 302, headers: { Location: DOCS_URL, "Cache-Control": "public, max-age=3600" } })
}
