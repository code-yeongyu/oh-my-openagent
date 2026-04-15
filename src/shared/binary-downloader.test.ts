import { describe, it, expect, spyOn, mock } from "bun:test"
import {
  downloadArchive,
  BinaryIntegrityError,
  DownloadArchiveOptions,
  ensureCacheDir,
  cleanupArchive,
} from "./binary-downloader"
import { writeFileSync, unlinkSync, existsSync, mkdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("binary-downloader", () => {
  describe("#given downloadArchive function", () => {
    const createTempDir = () => {
      return mkdtempSync(join(tmpdir(), "binary-downloader-test-"))
    }

    describe("#when expectedSha256 is provided and matches", () => {
      it("#then should download and verify successfully", async () => {
        // given: テスト用の一時ディレクトリと正しいSHA256
        const tempDir = createTempDir()
        const archivePath = join(tempDir, "test-archive.txt")
        const testContent = "Hello, World!"
        const expectedSha256 = "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
        // "Hello, World!" の SHA256

        // モック fetch レスポンス
        const originalFetch = global.fetch
        global.fetch = mock(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(Buffer.from(testContent)),
          } as Response)
        )

        try {
          // when: 正しいSHA256でダウンロード
          await downloadArchive("http://example.com/test.txt", archivePath, {
            expectedSha256,
          })

          // then: ファイルが存在すること
          expect(existsSync(archivePath)).toBe(true)
        } finally {
          // クリーンアップ
          global.fetch = originalFetch
          if (existsSync(archivePath)) {
            unlinkSync(archivePath)
          }
        }
      })
    })

    describe("#when expectedSha256 is provided but does not match", () => {
      it("#then should throw BinaryIntegrityError and delete file", async () => {
        // given: 間違ったSHA256
        const tempDir = createTempDir()
        const archivePath = join(tempDir, "test-archive.txt")
        const testContent = "Hello, World!"
        const wrongSha256 = "0000000000000000000000000000000000000000000000000000000000000000"

        // モック fetch
        const originalFetch = global.fetch
        global.fetch = mock(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(Buffer.from(testContent)),
          } as Response)
        )

        try {
          // when: 間違ったSHA256でダウンロード
          let errorThrown = false
          try {
            await downloadArchive("http://example.com/test.txt", archivePath, {
              expectedSha256: wrongSha256,
            })
          } catch (err) {
            errorThrown = true
            // then: BinaryIntegrityErrorがスローされる
            expect(err).toBeInstanceOf(BinaryIntegrityError)
            const error = err as BinaryIntegrityError
            expect(error.name).toBe("BinaryIntegrityError")
            expect(error.expectedHash).toBe(wrongSha256)
          }
          expect(errorThrown).toBe(true)

          // then: ファイルが削除されていること
          expect(existsSync(archivePath)).toBe(false)
        } finally {
          global.fetch = originalFetch
          if (existsSync(archivePath)) {
            unlinkSync(archivePath)
          }
        }
      })
    })

    describe("#when expectedSha256 is not provided", () => {
      it("#then should download without verification", async () => {
        // given: SHA256なし
        const tempDir = createTempDir()
        const archivePath = join(tempDir, "test-archive.txt")
        const testContent = "Hello, World!"

        // モック fetch
        const originalFetch = global.fetch
        global.fetch = mock(() =>
          Promise.resolve({
            ok: true,
            arrayBuffer: () => Promise.resolve(Buffer.from(testContent)),
          } as Response)
        )

        try {
          // when: SHA256なしでダウンロード
          await downloadArchive("http://example.com/test.txt", archivePath)

          // then: ファイルが存在すること（後方互換）
          expect(existsSync(archivePath)).toBe(true)
        } finally {
          global.fetch = originalFetch
          if (existsSync(archivePath)) {
            unlinkSync(archivePath)
          }
        }
      })
    })

    describe("#when HTTP request fails", () => {
      it("#then should throw error", async () => {
        // given: HTTPエラー
        const tempDir = createTempDir()
        const archivePath = join(tempDir, "test-archive.txt")

        // モック fetch - HTTPエラー
        const originalFetch = global.fetch
        global.fetch = mock(() =>
          Promise.resolve({
            ok: false,
            status: 404,
            statusText: "Not Found",
          } as Response)
        )

        try {
          // when/ then: エラーがスローされる
          expect(downloadArchive("http://example.com/test.txt", archivePath)).rejects.toThrow(
            "HTTP 404"
          )
        } finally {
          global.fetch = originalFetch
          if (existsSync(archivePath)) {
            unlinkSync(archivePath)
          }
        }
      })
    })
  })
})
