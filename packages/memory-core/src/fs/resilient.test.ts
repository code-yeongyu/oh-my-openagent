import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  EINTR_RETRY_CAP,
  existsSync,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  resilientNamespace,
  retryOnEintr,
  retryOnEintrSync,
  rm,
  wrapFileHandle,
  writeFile,
} from "./resilient"

function eintrError(syscall: string): NodeJS.ErrnoException {
  const error = new Error(`EINTR: interrupted system call, ${syscall}`) as NodeJS.ErrnoException
  error.code = "EINTR"
  return error
}

function eaccesError(): NodeJS.ErrnoException {
  const error = new Error("EACCES: permission denied") as NodeJS.ErrnoException
  error.code = "EACCES"
  return error
}

describe("retryOnEintr", () => {
  test("retries transient EINTR and returns the eventual result", async () => {
    let calls = 0
    const result = await retryOnEintr(async () => {
      calls += 1
      if (calls < 3) throw eintrError("open")
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })

  test("propagates a non-EINTR error without retrying", async () => {
    let calls = 0
    const failure = retryOnEintr(async () => {
      calls += 1
      throw eaccesError()
    })
    await expect(failure).rejects.toThrow("EACCES")
    expect(calls).toBe(1)
  })

  test("rethrows EINTR once the retry cap is exhausted", async () => {
    let calls = 0
    const failure = retryOnEintr(async () => {
      calls += 1
      throw eintrError("scandir")
    })
    await expect(failure).rejects.toThrow("EINTR")
    expect(calls).toBe(EINTR_RETRY_CAP + 1)
  })
})

describe("retryOnEintrSync", () => {
  test("retries transient EINTR and returns the eventual result", () => {
    let calls = 0
    const result = retryOnEintrSync(() => {
      calls += 1
      if (calls < 3) throw eintrError("readdir")
      return "ok"
    })
    expect(result).toBe("ok")
    expect(calls).toBe(3)
  })

  test("propagates a non-EINTR error without retrying", () => {
    let calls = 0
    expect(() =>
      retryOnEintrSync(() => {
        calls += 1
        throw eaccesError()
      }),
    ).toThrow("EACCES")
    expect(calls).toBe(1)
  })

  test("rethrows EINTR once the retry cap is exhausted", () => {
    let calls = 0
    expect(() =>
      retryOnEintrSync(() => {
        calls += 1
        throw eintrError("readdir")
      }),
    ).toThrow("EINTR")
    expect(calls).toBe(EINTR_RETRY_CAP + 1)
  })
})

describe("wrapFileHandle", () => {
  test("retries EINTR on async methods", async () => {
    let calls = 0
    const fake = {
      sync: () => {
        calls += 1
        if (calls < 2) return Promise.reject(eintrError("fsync"))
        return Promise.resolve()
      },
    }
    const wrapped = wrapFileHandle(fake)
    await wrapped.sync()
    expect(calls).toBe(2)
  })

  test("treats EINTR on close as closed", async () => {
    const fake = {
      close: () => Promise.reject(eintrError("close")),
    }
    const wrapped = wrapFileHandle(fake)
    await expect(wrapped.close()).resolves.toBeUndefined()
  })

  test("propagates a non-EINTR close failure", async () => {
    const fake = {
      close: () => Promise.reject(eaccesError()),
    }
    const wrapped = wrapFileHandle(fake)
    await expect(wrapped.close()).rejects.toThrow("EACCES")
  })

  test("passes non-function properties through", () => {
    const fake = { fd: 7 }
    const wrapped = wrapFileHandle(fake)
    expect(wrapped.fd).toBe(7)
  })

  test("does not retry write-family methods whose progress is stateful", async () => {
    let calls = 0
    const fake = {
      write: () => {
        calls += 1
        return Promise.reject(eintrError("write"))
      },
    }
    const wrapped = wrapFileHandle(fake)
    await expect(wrapped.write()).rejects.toThrow("EINTR")
    expect(calls).toBe(1)
  })

  test("treats EINTR on async dispose as closed", async () => {
    const fake = {
      [Symbol.asyncDispose]: () => Promise.reject(eintrError("close")),
    }
    const wrapped = wrapFileHandle(fake)
    await expect(wrapped[Symbol.asyncDispose]()).resolves.toBeUndefined()
  })
})

describe("resilientNamespace", () => {
  test("retries EINTR through wrapped async namespace functions", async () => {
    let calls = 0
    const namespace = {
      op: async () => {
        calls += 1
        if (calls < 3) throw eintrError("open")
        return "ok"
      },
    }
    const wrapped = resilientNamespace(namespace, "async")
    expect(await wrapped.op()).toBe("ok")
    expect(calls).toBe(3)
  })

  test("retries EINTR through wrapped sync namespace functions", () => {
    let calls = 0
    const namespace = {
      op: () => {
        calls += 1
        if (calls < 3) throw eintrError("scandir")
        return "ok"
      },
    }
    const wrapped = resilientNamespace(namespace, "sync")
    expect(wrapped.op()).toBe("ok")
    expect(calls).toBe(3)
  })

  test("caches wrapped functions and passes non-functions through", () => {
    const namespace = { op: () => "ok", limit: 42 }
    const wrapped = resilientNamespace(namespace, "sync")
    expect(wrapped.op).toBe(wrapped.op)
    expect(wrapped.limit).toBe(42)
  })

  test("wraps the native variant alongside its parent function", () => {
    let nativeCalls = 0
    const parent = Object.assign(() => "parent", {
      native: () => {
        nativeCalls += 1
        if (nativeCalls < 2) throw eintrError("realpath")
        return "native"
      },
    })
    const wrapped = resilientNamespace({ realpathSync: parent }, "sync")
    expect(wrapped.realpathSync.native()).toBe("native")
    expect(nativeCalls).toBe(2)
  })
})

describe("resilient fs integration (real filesystem)", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("round-trips writes, reads, listings, and handles", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resilient-fs-"))
    temporaryDirectories.push(directory)

    await mkdir(path.join(directory, "nested"), { recursive: true })
    const file = path.join(directory, "nested", "value.txt")
    await writeFile(file, "hello", "utf8")

    expect(await readFile(file, "utf8")).toBe("hello")
    expect(await readdir(path.join(directory, "nested"))).toContain("value.txt")
    expect(existsSync(file)).toBe(true)
    expect(existsSync(path.join(directory, "missing"))).toBe(false)

    const handle = await open(file, "r")
    try {
      const stats = await handle.stat()
      expect(stats.size).toBe(5)
    } finally {
      await handle.close()
    }
  })
})
