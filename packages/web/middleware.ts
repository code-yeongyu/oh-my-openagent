import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from "next-intl/middleware"
import { locales, type Locale } from "./i18n/config"
import { routing } from "./i18n/routing"

const handleI18nRouting = createMiddleware(routing)
const oldHosts = new Set(["ohmyopencode.org", "www.ohmyopencode.org"])
const primaryHost = "ohmyopenagent.com"
const installationPaths = new Set([
  "installation",
  "installation.md",
  "docs/installation",
  "docs/installation.md",
])

function getLocaleSegment(segment: string | undefined): Locale | null {
  if (!segment) return null
  return locales.find((locale) => locale === segment) ?? null
}

function getInstallationDocsPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean)
  const locale = getLocaleSegment(segments[0])
  const routeSegments = locale ? segments.slice(1) : segments

  if (!installationPaths.has(routeSegments.join("/"))) return null

  return locale ? `/${locale}/docs` : "/docs"
}

export default function middleware(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")
  const requestHost = request.headers.get("host")
  const hostname = (forwardedHost ?? requestHost ?? request.nextUrl.hostname).split(":")[0]
  const redirectUrl = request.nextUrl.clone()
  let shouldRedirect = false

  if (hostname && oldHosts.has(hostname)) {
    redirectUrl.protocol = "https"
    redirectUrl.host = primaryHost
    shouldRedirect = true
  }

  const installationDocsPath = getInstallationDocsPath(request.nextUrl.pathname)
  if (installationDocsPath) {
    redirectUrl.pathname = installationDocsPath
    redirectUrl.search = ""
    redirectUrl.hash = "installation"
    shouldRedirect = true
  }

  if (shouldRedirect) {
    return NextResponse.redirect(redirectUrl, 308)
  }

  return handleI18nRouting(request)
}

export const config = {
  matcher: [
    "/",
    "/((?!api|_next|_vercel|.*\\..*).+)",
    "/installation.md",
    "/:locale(en|ko|ja|zh)/installation.md",
    "/docs/installation.md",
    "/:locale(en|ko|ja|zh)/docs/installation.md",
  ],
}
