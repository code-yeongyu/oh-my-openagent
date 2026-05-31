import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import { runMcpStdioServer } from "./mcp";

describe("ast-grep MCP stdio server", () => {
  it("#given Codex sends a content-length framed initialize #when stdio server handles it #then responds with a framed initialize result", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const received = nextOutput(output);
    const server = runMcpStdioServer(input, output);

    writeContentLengthFrame(input, {
      jsonrpc: "2.0",
      id: 5,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "codex", version: "0.0.0" },
      },
    });

    const response = parseContentLengthFrame(await received);
    input.end();
    await server;

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: {
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ast_grep", version: "0.1.0" },
        protocolVersion: "2024-11-05",
      },
    });
  });
});

function writeContentLengthFrame(input: PassThrough, message: unknown): void {
  const body = JSON.stringify(message);
  input.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function nextOutput(output: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    output.once("data", (chunk: Buffer | string) => {
      resolve(String(chunk));
    });
  });
}

function parseContentLengthFrame(raw: string): unknown {
  const separator = raw.indexOf("\r\n\r\n");
  expect(separator).toBeGreaterThan(0);
  const headers = raw.slice(0, separator);
  const match = /^Content-Length: (\d+)$/im.exec(headers);
  expect(match).not.toBeNull();
  if (match === null) throw new TypeError(`Missing Content-Length header: ${raw}`);
  const lengthValue = match[1];
  if (lengthValue === undefined) throw new TypeError(`Invalid Content-Length header: ${raw}`);
  const bodyStart = separator + "\r\n\r\n".length;
  return JSON.parse(raw.slice(bodyStart, bodyStart + Number(lengthValue)));
}
