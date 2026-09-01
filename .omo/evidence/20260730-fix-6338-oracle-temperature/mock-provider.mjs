// Minimal OpenAI-compatible endpoint used as a stand-in model for the #6338 live proof.
// It records every request body it receives so the driver can assert whether the outgoing
// request still carries `temperature`, which is exactly the evidence in the issue report.
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const outFile = process.argv[2];
if (!outFile) {
  console.error("usage: mock-provider.mjs <request-log.json>");
  process.exit(2);
}

const bodies = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    if (req.method === "POST") {
      try {
        bodies.push({ url: req.url, body: JSON.parse(raw) });
      } catch {
        bodies.push({ url: req.url, body: raw });
      }
      writeFileSync(outFile, JSON.stringify(bodies, null, 2));
    }

    if (req.method !== "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [] }));
      return;
    }

    // Stream a single-token OpenAI-compatible completion so the client finishes cleanly.
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const id = "chatcmpl-mock";
    const model = "claude-opus-4-8";
    const frame = (delta, finish) =>
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta, finish_reason: finish ?? null }],
      })}\n\n`;
    res.write(frame({ role: "assistant", content: "" }));
    res.write(frame({ content: "OK" }));
    res.write(frame({}, "stop"));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  // The driver reads this line to learn the port.
  console.log(`MOCK_PORT=${port}`);
});

process.on("SIGTERM", () => {
  writeFileSync(outFile, JSON.stringify(bodies, null, 2));
  server.close(() => process.exit(0));
});
