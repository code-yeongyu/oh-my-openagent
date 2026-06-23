import type { TextSection } from "./text-chunker"

export interface RemoteDoclingCommand {
  mode: "url" | "base64"
  source?: string
  base64Content?: string
  sourceDocument: string
}

export interface RemoteDoclingInput {
  sourceDocument: string
  title?: string
  sourceUrl?: string
  content: Uint8Array
}

export interface RemoteDoclingDeps {
  runRemoteDocling?(command: RemoteDoclingCommand): Promise<string>
  remoteDoclingHost?: string
  remoteDoclingPythonEnv?: string
  remoteDoclingPythonBin?: string
}

export interface RemoteDoclingShellScript {
  host: string
  shell: string
}

export function buildRemoteDoclingCommand(input: RemoteDoclingInput): RemoteDoclingCommand {
  if (input.sourceUrl && /^https?:\/\//i.test(input.sourceUrl)) {
    return {
      mode: "url",
      source: input.sourceUrl,
      sourceDocument: input.sourceDocument,
    }
  }

  return {
    mode: "base64",
    base64Content: Buffer.from(input.content).toString("base64"),
    sourceDocument: input.sourceDocument,
  }
}

export async function parsePdfWithRemoteDocling(
  input: RemoteDoclingInput,
  deps: RemoteDoclingDeps = {},
): Promise<TextSection[]> {
  const runRemoteDocling = deps.runRemoteDocling ?? defaultRunRemoteDocling
  const markdown = await runRemoteDocling(buildRemoteDoclingCommand(input))
  const text = markdown.trim()

  if (!text) {
    throw new Error(`Remote Docling returned no text for ${input.sourceDocument}`)
  }

  return [
    {
      heading: input.title,
      text,
    },
  ]
}

export function buildRemoteDoclingShellScript(
  command: RemoteDoclingCommand,
  deps: Pick<RemoteDoclingDeps, "remoteDoclingHost" | "remoteDoclingPythonEnv" | "remoteDoclingPythonBin"> = {},
): RemoteDoclingShellScript {
  const host = deps.remoteDoclingHost ?? "arch"
  const pythonBin = resolvePythonBin(deps)
  const pythonBody = command.mode === "url"
    ? `from docling.document_converter import DocumentConverter
converter = DocumentConverter()
result = converter.convert(${JSON.stringify(command.source)})
print(result.document.export_to_markdown())`
    : `import base64, os, sys, tempfile
from pathlib import Path
from docling.document_converter import DocumentConverter

payload = sys.stdin.read()
suffix = Path(${JSON.stringify(command.sourceDocument)}).suffix or ".pdf"
with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
    tmp.write(base64.b64decode(payload))
    temp_path = tmp.name

try:
    converter = DocumentConverter()
    result = converter.convert(temp_path)
    print(result.document.export_to_markdown())
finally:
    try:
        os.unlink(temp_path)
    except FileNotFoundError:
        pass`

  const encodedScript = Buffer.from(pythonBody, "utf8").toString("base64")
  const bootstrap = command.mode === "base64"
    ? `import base64,sys,subprocess; script=base64.b64decode("${encodedScript}").decode(); subprocess.run([${JSON.stringify(pythonBin)}, "-c", script], check=True, stdin=sys.stdin)`
    : `import base64,sys,subprocess; script=base64.b64decode("${encodedScript}").decode(); subprocess.run([${JSON.stringify(pythonBin)}, "-c", script], check=True)`
  const shell = `${pythonBin} -c ${JSON.stringify(bootstrap)}`

  return {
    host,
    shell,
  }
}

function resolvePythonBin(
  deps: Pick<RemoteDoclingDeps, "remoteDoclingPythonEnv" | "remoteDoclingPythonBin">,
): string {
  if (deps.remoteDoclingPythonBin && deps.remoteDoclingPythonBin.trim().length > 0) {
    return deps.remoteDoclingPythonBin
  }
  const env = deps.remoteDoclingPythonEnv?.trim()
  if (!env) return "$HOME/l3-env/bin/python3"
  const activateSuffix = "/bin/activate"
  if (env.endsWith(activateSuffix)) {
    return `${env.slice(0, -activateSuffix.length)}/bin/python3`
  }
  return `${env.replace(/\/$/, "")}/bin/python3`
}

async function defaultRunRemoteDocling(command: RemoteDoclingCommand): Promise<string> {
  const remote = buildRemoteDoclingShellScript(command)

  const sshCmd = ["ssh", remote.host, remote.shell]

  if (command.mode === "url") {
    const proc = Bun.spawn({
      cmd: sshCmd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (exitCode !== 0) {
      throw new Error(`Remote Docling failed (exit ${exitCode}). stderr: ${stderrText.slice(0, 2000)} | stdout: ${stdoutText.slice(0, 500)}`)
    }
    return stdoutText
  }

  const proc = Bun.spawn({
    cmd: sshCmd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdinPayload = command.base64Content ?? ""
  proc.stdin.write(stdinPayload)
  proc.stdin.end()
  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`Remote Docling failed (exit ${exitCode}). stderr: ${stderrText.slice(0, 2000)} | stdout: ${stdoutText.slice(0, 500)}`)
  }
  return stdoutText
}
