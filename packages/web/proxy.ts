import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from "next-intl/middleware"
import { locales, type Locale } from "./i18n/config"
import { routing } from "./i18n/routing"

const handleI18nRouting = createMiddleware(routing)
const oldHosts = new Set(["www.omo.dev"])
const primaryHost = "omo.dev"
const installationPaths = new Set([
  "installation",
  "installation.md",
  "docs/installation",
  "docs/installation.md",
])

// get.omo.dev sent browsers here before /docs/install existed.
const installGuidePaths = new Set([
  "docs/guide/installation",
  "docs/guide/install",
  "docs/guide/install.md",
])

const desktopPaths = new Set(["desktop"])

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

function getInstallGuidePath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean)
  const locale = getLocaleSegment(segments[0])
  const routeSegments = locale ? segments.slice(1) : segments

  if (!installGuidePaths.has(routeSegments.join("/"))) return null

  return locale ? `/${locale}/docs/install` : "/docs/install"
}

function getDownloadPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean)
  const locale = getLocaleSegment(segments[0])
  const routeSegments = locale ? segments.slice(1) : segments

  if (!desktopPaths.has(routeSegments.join("/"))) return null

  return locale ? `/${locale}/download` : "/download"
}

export default function proxy(request: NextRequest): NextResponse {
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

  const installGuidePath = getInstallGuidePath(request.nextUrl.pathname)
  if (installGuidePath) {
    redirectUrl.pathname = installGuidePath
    shouldRedirect = true
  }

  const downloadPath = getDownloadPath(request.nextUrl.pathname)
  if (downloadPath) {
    redirectUrl.pathname = downloadPath
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
    /*
     * Match everything except:
     * - api routes
     * - /design (dev-only, non-localized primitive showcase; see app/design/page.tsx)
     * - Next.js internals (_next, _vercel)
     * - Next.js file-based metadata routes (opengraph-image, twitter-image, icon, apple-icon, manifest, robots, sitemap)
     *   These serve images / JSON / XML directly and must NOT be redirected by i18n.
     * - Any path containing a dot (favicon.ico, *.webp, *.png, etc.)
     */
    "/((?!api|design|_next|_vercel|opengraph-image|twitter-image|icon|apple-icon|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\..*).+)",
    "/installation.md",
    "/:locale(en|ko|ja|zh)/installation.md",
    "/docs/installation.md",
    "/docs/guide/install.md",
    "/:locale(en|ko|ja|zh)/docs/guide/install.md",
    "/:locale(en|ko|ja|zh)/docs/installation.md",
  ],
}
