// mock-model.mjs - a local OpenAI Responses-API SSE server for codex-qa.
//
// WHY: codex talks to a model over HTTP. Pointing a custom model_provider at
// this server lets QA drive a REAL codex turn end-to-end with NO real API
// call, no key, and no network egress - so we test OUR plugin, never OpenAI.
//
// It answers POST .../responses with the 3-event Responses stream codex needs
// for one assistant message (response.created -> output_item.done ->
// response.completed). Each POST gets a fresh response, so a turn that makes
// several model requests (session-start probe + the turn itself) is covered.
//
// Env:
//   MOCK_PORT  TCP port to bind (default 0 = OS-assigned; the chosen port is
//              printed as "MOCK_LISTENING <port>" on stdout so the caller can
//              read it back).
//   MOCK_TEXT  assistant message text (default below).
import { createServer } from "node:http";

const TEXT = process.env.MOCK_TEXT || "Hello from the codex-qa mock model.";

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url && req.url.endsWith("/responses")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const sse = (obj) => res.write(`event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`);
      sse({ type: "response.created", response: { id: "resp-1" } });
      sse({
        type: "response.output_item.done",
        item: {
          type: "message",
          role: "assistant",
          id: "msg-1",
          content: [{ type: "output_text", text: TEXT }],
        },
      });
      sse({
        type: "response.completed",
        response: { id: "resp-1", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
      });
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});

const port = Number(process.env.MOCK_PORT || 0);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`MOCK_LISTENING ${server.address().port}\n`);
});
