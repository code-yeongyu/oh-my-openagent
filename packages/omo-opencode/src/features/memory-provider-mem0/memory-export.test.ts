import { describe, expect, it } from "bun:test"
import {
  createExportRequest,
  type ExportClient,
  type ExportJob,
  MemoryExportError,
  pollExport,
  validateExportRequest,
} from "./memory-export"

describe("validateExportRequest", () => {
  it("#given valid schema #when validated #then no throw", () => {
    expect(() =>
      validateExportRequest({ schema: { fields: ["id", "memory"] } }),
    ).not.toThrow()
  })

  it("#given missing fields array #when validated #then throws", () => {
    expect(() =>
      validateExportRequest({ schema: { fields: undefined as never } }),
    ).toThrow(MemoryExportError)
  })

  it("#given empty fields #when validated #then throws", () => {
    expect(() => validateExportRequest({ schema: { fields: [] } })).toThrow(
      MemoryExportError,
    )
  })
})

describe("createExportRequest", () => {
  it("#given valid request #when created #then returns export_id", async () => {
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-123" }),
      getExport: async () => ({ export_id: "exp-123", status: "pending" }),
    }
    const id = await createExportRequest(client, { schema: { fields: ["id"] } })
    expect(id).toBe("exp-123")
  })

  it("#given client returns empty id #when created #then throws", async () => {
    const client: ExportClient = {
      createExport: async () => ({ export_id: "" }),
      getExport: async () => ({ export_id: "", status: "pending" }),
    }
    await expect(
      createExportRequest(client, { schema: { fields: ["id"] } }),
    ).rejects.toThrow(MemoryExportError)
  })
})

describe("pollExport", () => {
  it("#given completed status on first poll #when polled #then returns job", async () => {
    const job: ExportJob = {
      export_id: "exp-1",
      status: "completed",
      download_url: "https://example.com/e.json",
    }
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-1" }),
      getExport: async () => job,
    }
    const result = await pollExport(client, "exp-1", {
      sleep: async () => {},
      intervalMs: 1,
    })
    expect(result.download_url).toBe("https://example.com/e.json")
  })

  it("#given processing then completed #when polled #then waits and returns", async () => {
    let calls = 0
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-2" }),
      getExport: async () => {
        calls++
        return {
          export_id: "exp-2",
          status: calls < 3 ? "processing" : "completed",
          download_url: "https://example.com/e.json",
        }
      },
    }
    const statuses: string[] = []
    const result = await pollExport(client, "exp-2", {
      sleep: async () => {},
      intervalMs: 1,
      onStatus: (j) => statuses.push(j.status),
    })
    expect(calls).toBe(3)
    expect(statuses).toEqual(["processing", "processing", "completed"])
    expect(result.status).toBe("completed")
  })

  it("#given failed status #when polled #then throws with error message", async () => {
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-3" }),
      getExport: async () => ({
        export_id: "exp-3",
        status: "failed",
        error: "quota exceeded",
      }),
    }
    await expect(
      pollExport(client, "exp-3", { sleep: async () => {}, intervalMs: 1 }),
    ).rejects.toThrow(/quota exceeded/)
  })

  it("#given max attempts reached #when polled #then throws timeout error", async () => {
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-4" }),
      getExport: async () => ({ export_id: "exp-4", status: "processing" }),
    }
    await expect(
      pollExport(client, "exp-4", {
        sleep: async () => {},
        intervalMs: 1,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/did not complete/)
  })

  it("#given backoff applied #when polled #then sleep durations grow", async () => {
    const client: ExportClient = {
      createExport: async () => ({ export_id: "exp-5" }),
      getExport: async () => ({ export_id: "exp-5", status: "processing" }),
    }
    const sleeps: number[] = []
    await expect(
      pollExport(client, "exp-5", {
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        intervalMs: 10,
        backoffFactor: 2,
        maxAttempts: 4,
      }),
    ).rejects.toThrow(MemoryExportError)
    expect(sleeps).toEqual([10, 20, 40])
  })
})
