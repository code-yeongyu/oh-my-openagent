const [originA, originB] = process.argv.slice(2)
if (!originA || !originB) throw new Error("Pass the build A and build B preview origins")

const agents = {
  safari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  webview:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
}

async function request(url, agent, language) {
  return fetch(url, {
    headers: { "user-agent": agent, "accept-language": language },
    signal: AbortSignal.timeout(30_000),
  })
}

async function document(origin, route, agent, language) {
  const response = await request(new URL(route, origin), agent, language)
  if (response.status !== 200 || new URL(response.url).origin !== new URL(origin).origin) {
    throw new Error(
      `Preview document did not remain on its origin: ${response.status} ${response.url}`,
    )
  }
  const html = await response.text()
  const styles = []
  await new HTMLRewriter()
    .on('link[rel="stylesheet"]', {
      element(element) {
        const href = element.getAttribute("href")
        if (href) styles.push(href)
      },
    })
    .transform(new Response(html))
    .text()
  const internalStyles = [
    ...new Set(
      styles
        .map((href) => new URL(href, response.url))
        .filter((url) => url.origin === new URL(origin).origin)
        .map((url) => url.pathname + url.search),
    ),
  ]
  if (!internalStyles.length) throw new Error(`No application stylesheet in ${route}`)
  return {
    route,
    cacheControl: response.headers.get("cache-control"),
    documentSha256: new Bun.CryptoHasher("sha256").update(html).digest("hex"),
    styles: internalStyles,
  }
}

async function stylesheet(origin, href, agent, language) {
  const response = await request(new URL(href, origin), agent, language)
  const contentType = response.headers.get("content-type")
  const bytes = (await response.arrayBuffer()).byteLength
  return {
    href,
    status: response.status,
    contentType,
    bytes,
    usable: response.status === 200 && contentType?.split(";")[0] === "text/css" && bytes > 0,
  }
}

const results = []
for (const [agentName, agent] of Object.entries(agents)) {
  for (const [route, language] of [
    ["/ko/manifesto", "ko"],
    ["/manifesto", "en"],
  ]) {
    const retainedA = await document(originA, route, agent, language)
    const currentB = await document(originB, route, agent, language)
    const controlA = await Promise.all(
      retainedA.styles.map((href) => stylesheet(originA, href, agent, language)),
    )
    const controlB = await Promise.all(
      currentB.styles.map((href) => stylesheet(originB, href, agent, language)),
    )
    const retainedAfterB = await Promise.all(
      retainedA.styles.map((href) => stylesheet(originB, href, agent, language)),
    )
    const changed = retainedA.styles.some((href) => !currentB.styles.includes(href))
    const result = {
      agentName,
      language,
      retainedA,
      currentB,
      changed,
      controlA,
      controlB,
      retainedAfterB,
    }
    results.push(result)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
}

if (results.some((r) => !r.changed)) {
  throw new Error("A/B did not exercise different stylesheet URLs; this is not a skew proof")
}
if (results.some((r) => [...r.controlA, ...r.controlB].some((css) => !css.usable))) {
  throw new Error("An unchanged-build control failed; classify that failure before judging skew")
}
const failures = results.flatMap((r) => r.retainedAfterB.filter((css) => !css.usable))
process.stdout.write(
  JSON.stringify({
    kind: "retained-document-styles",
    cases: results.length,
    failures: failures.length,
  }) + "\n",
)
process.exitCode = failures.length ? 2 : 0
