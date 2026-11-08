import { z } from "zod"
import { AuditError } from "./contracts"
import { Rpc } from "./rpc"
import type { Runtime } from "./runtime"

const paragraphs = "This local article explains deterministic fixture rendering, table content, relative links, and independent captures. ".repeat(4)
const html = {
  reader: `<!doctype html><html><head><title>Audit reader</title></head><body><nav>Discard navigation</nav><article><h1>Reader fixture</h1><p>${paragraphs}</p><p>Second paragraph <strong>bold</strong> and <a href="/destination">link</a>.</p></article><footer>Discard footer</footer></body></html>`,
  tistory: `<!doctype html><html><head><title>Audit tistory</title></head><body><div class="tt_article_useless_p_margin contents_style"><h2>Tistory fixture</h2><p>${paragraphs}</p><ul><li>First</li><li>Second</li></ul><table><tbody><tr><td>cell</td></tr></tbody></table></div></body></html>`,
  base: `<!doctype html><html><head><base href="../assets/"><title>Audit redirect</title></head><body><article><h1>Redirect fixture</h1><p>${paragraphs}</p><p><a href="guide">Guide</a><a href="#section">Section</a><img src="image.png" alt="fixture"></p></article></body></html>`,
} as const
const resultSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  details: z.object({ status: z.literal(200), converted: z.literal(true), finalUrl: z.string(),
    truncated: z.boolean(), outputTruncated: z.boolean(), outputBytes: z.number(), outputTotalBytes: z.number(),
  }).passthrough(),
})
export async function captureWebfetch(runtime: Runtime) {
  const requests: string[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 15,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push(path)
      switch (path) {
        case "/fixtures/base/start": return new Response(null, { status: 302, headers: { location: "/fixtures/base/final" } })
        case "/fixtures/reader": return new Response(html.reader, { headers: { "content-type": "text/html; charset=utf-8" } })
        case "/fixtures/tistory": return new Response(html.tistory, { headers: { "content-type": "text/html; charset=utf-8" } })
        case "/fixtures/base/final": return new Response(html.base, { headers: { "content-type": "text/html; charset=utf-8" } })
        default: return new Response("unknown local fixture", { status: 404 })
      }
    },
  })
  try {
    await using rpc = new Rpc(runtime, "classic")
    await rpc.request({ type: "get_protocol_info" })
    const fixtures = []
    for (const path of ["/fixtures/reader", "/fixtures/tistory", "/fixtures/base/start"]) {
      const url = `http://127.0.0.1:${server.port}${path}`
      const markdown = resultSchema.parse(await rpc.extension("audit.webfetch", { url, format: "markdown" }))
      const text = resultSchema.parse(await rpc.extension("audit.webfetch", { url, format: "text" }))
      if (markdown.content.length === 0 || text.content.length === 0) throw new AuditError("webfetch", "empty tool output")
      fixtures.push({ path, markdown: markdown.content.map((part) => part.text).join(""), text: text.content.map((part) => part.text).join(""),
        ...markdown.details, textDetails: text.details })
    }
    return { pass: true, fixtures, requests, serverClosed: true }
  } finally { await server.stop(true) }
}
