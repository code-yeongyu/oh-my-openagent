// Reproduces the Windows teardown race from #9601 on any OS: the transport
// disposes its JSON-RPC connection, then the server's stdin pipe fails with
// EPIPE. Windows reports that failure asynchronously, after dispose removed the
// connection's listener, so the stream is destroyed with the error here to get
// the same event order deterministically. The probe exits 0 only when the error
// was handled; an unhandled 'error' event crashes it with a non-zero exit.
import { JsonRpcConnection } from "../json-rpc-connection.js";
import { spawnProcess } from "../process.js";

const server = spawnProcess([process.execPath, "-e", "process.stdin.on('close', () => process.exit(0)).resume()"], {
	cwd: process.cwd(),
	env: process.env,
});
const connection = new JsonRpcConnection(server.stdout, server.stdin);
connection.listen();
connection.dispose();

const stdinClosed = new Promise<void>((resolve) => server.stdin.once("close", () => resolve()));
const epipe = Object.assign(new Error("EPIPE: broken pipe, write"), { code: "EPIPE", syscall: "write", errno: -4047 });
if (!("destroy" in server.stdin) || typeof server.stdin.destroy !== "function") {
	throw new Error("server stdin is not destroyable");
}
server.stdin.destroy(epipe);
await stdinClosed;

server.kill("SIGKILL");
await server.exited;
process.stdout.write("PROBE_SURVIVED\n");
