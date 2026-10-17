type NodeWritableStdin = {
  on(event: "error", listener: (error: Error) => void): unknown
  end(chunk: string, callback: (error?: Error | null) => void): unknown
}

type FileSinkStdin = {
  write(chunk: string): unknown
  end(): unknown
}

function isNodeWritable(stdin: NodeWritableStdin | FileSinkStdin): stdin is NodeWritableStdin {
  return typeof (stdin as { on?: unknown }).on === "function"
}

function sendThroughNodeWritable(stdin: NodeWritableStdin, input: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error | null) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    // Stays attached for the stream's lifetime: Node and Bun can emit the closed-pipe error after the
    // end() callback, and an 'error' event with no listener ends the whole host (#6396).
    stdin.on("error", settle)
    stdin.end(input, settle)
  })
}

async function sendThroughFileSink(stdin: FileSinkStdin, input: string): Promise<void> {
  await stdin.write(input)
  await stdin.end()
}

export function sendAndCloseStdin(stdin: NodeWritableStdin | FileSinkStdin, input: string): Promise<void> {
  try {
    return isNodeWritable(stdin) ? sendThroughNodeWritable(stdin, input) : sendThroughFileSink(stdin, input)
  } catch (error) {
    return Promise.reject(error)
  }
}
