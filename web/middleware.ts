import { NextResponse, type NextRequest } from "next/server"
import createMiddleware from "next-intl/middleware"
import { routing } from "./i18n/routing"

const handleI18nRouting = createMiddleware(routing)
const oldHosts = new Set(["ohmyopencode.org", "www.ohmyopencode.org"])
const primaryHost = "ohmyopenagent.com"

export default function middleware(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")
  const requestHost = request.headers.get("host")
  const hostname = (forwardedHost ?? requestHost ?? request.nextUrl.hostname).split(":")[0]

  if (hostname && oldHosts.has(hostname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.protocol = "https"
    redirectUrl.host = primaryHost
    return NextResponse.redirect(redirectUrl, 308)
  }

  return handleI18nRouting(request)
}

export const config = {
  matcher: ["/", "/((?!api|_next|_vercel|.*\\..*).+)"],
}
