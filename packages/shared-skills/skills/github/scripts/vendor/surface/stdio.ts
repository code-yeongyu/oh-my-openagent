// The stdio binding: one JSON-RPC message per line in, one per line out. Requests run
// concurrently and answer in the order they finish; the server ends when its input ends and
// every request in flight has answered. Nothing but MCP messages goes to `write`.
import { ERRORS, type Connection, type McpHandler } from "./mcp.ts";

export type StdioStreams = {
  readonly input: ReadableStream<Uint8Array>;
  readonly write: (line: string) => void;
};

export const serveStdio = async (
  handler: McpHandler,
  streams: StdioStreams,
): Promise<void> => {
  const connection: Connection = { legacy: undefined };
  const inFlight = new Set<Promise<void>>();
  const answer = async (line: string): Promise<void> => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      streams.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: ERRORS.parse, message: "Parse error" },
        }),
      );
      return;
    }
    const reply = await handler.handle(message, connection);
    if (reply !== undefined) streams.write(JSON.stringify(reply));
  };
  const decoder = new TextDecoder();
  let pending = "";
  const take = (text: string): void => {
    pending += text;
    let end = pending.indexOf("\n");
    while (end >= 0) {
      const line = pending.slice(0, end).trim();
      pending = pending.slice(end + 1);
      if (line !== "") {
        const work = answer(line);
        inFlight.add(work);
        void work.finally(() => inFlight.delete(work));
      }
      end = pending.indexOf("\n");
    }
  };
  for await (const chunk of streams.input)
    take(decoder.decode(chunk, { stream: true }));
  take(`${decoder.decode()}\n`);
  await Promise.all(inFlight);
};
