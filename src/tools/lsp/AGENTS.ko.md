# src/tools/lsp/ — LSP 도구 구현

**생성일:** 2026-04-11

## 개요

33개 파일. 6개 도구로 노출되는 풀 LSP (Language Server Protocol) 클라이언트 스택. 서버 프로세스 관리, 파일 열기, 요청 전달을 수행하는 사용자 정의 구현 — OpenCode의 내장 LSP에 위임하지 **않음**.

## 도구 노출

| Tool | 파일 | 역할 |
|------|------|--------------|
| `lsp_goto_definition` | `goto-definition-tool.ts` | 심볼 정의로 점프 |
| `lsp_find_references` | `find-references-tool.ts` | 심볼의 모든 사용처 |
| `lsp_symbols` | `symbols-tool.ts` | 문서 outline 또는 워크스페이스 심볼 검색 |
| `lsp_diagnostics` | `diagnostics-tool.ts` | 언어 서버에서 받은 에러/경고 |
| `lsp_prepare_rename` | `rename-tools.ts` | 적용 전 rename 검증 |
| `lsp_rename` | `rename-tools.ts` | 워크스페이스 전반에 안전한 rename 적용 |

6개 모두 직접 `ToolDefinition` 객체 (팩토리 함수가 아님) — `tool-registry.ts`에 직접 등록됨.

## 아키텍처

```
tools.ts (6 ToolDefinition exports)
  ↓ uses
LspClientWrapper (lsp-client-wrapper.ts)
  ↓ wraps
LSPClient (lsp-client.ts) extends LSPClientConnection (lsp-client-connection.ts)
  ↓ communicates via
LSPClientTransport (lsp-client-transport.ts)
  ↓ talks to
LSPProcess (lsp-process.ts) — 서버 바이너리 spawn
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `lsp-client-wrapper.ts` | 고수준 진입점: 서버 해석, 파일 열기, 요청 실행 |
| `lsp-client.ts` | `LSPClient` — 파일 추적, 문서 동기화 (`didOpen`/`didChange`) |
| `lsp-client-connection.ts` | JSON-RPC 요청/응답/알림 레이어 |
| `lsp-client-transport.ts` | stdin/stdout 바이트 스트림 프레이밍 |
| `lsp-process.ts` | LSP 서버 프로세스 spawn + 클린업 |
| `lsp-manager-process-cleanup.ts` | 종료 시 고아 LSP 프로세스 회수 |
| `lsp-manager-temp-directory-cleanup.ts` | 일부 서버가 사용한 임시 디렉토리 정리 |
| `server-definitions.ts` | OpenCode의 `server.ts`에서 동기화된 40개 이상의 내장 서버 |
| `server-config-loader.ts` | `.opencode/lsp.json`에서 사용자 정의 서버 config 로드 |
| `server-resolution.ts` | 파일 확장자를 처리할 서버 해석 |
| `server-installation.ts` | 누락된 바이너리 감지, 설치 힌트 표시 |
| `language-mappings.ts` | 확장자 → 언어 ID 매핑 |
| `lsp-formatters.ts` | LSP 응답을 사람이 읽을 수 있는 문자열로 포맷 |
| `workspace-edit.ts` | `WorkspaceEdit` 결과를 디스크에 적용 (rename용) |
| `types.ts` | `LSPServerConfig`, `Position`, `Range`, `Location`, `Diagnostic` 등 |

## 서버 해석

```
file.ts → 확장자 (.ts) → language-mappings → 서버 ID (typescript)
  → server-resolution: 사용자 config (.opencode/lsp.json) 확인 → server-definitions.ts로 폴백
  → server-installation: 바이너리 존재 검증 (없으면 설치 힌트로 경고)
  → LSPProcess.spawn(command[])
```

## 노트

- LSP 요청 전에 반드시 `didOpen`을 통해 파일을 열어야 함 — `LSPClient.openFile()`이 이를 처리
- 요청 전송 전 서버 초기화를 위해 `didOpen` 후 1s 지연
- `lsp_servers` 도구는 제거됨 — OpenCode 내장 `LspServers` 도구와 중복
- OpenCode의 `server.ts`와 동기화 — 서버 추가 시 먼저 upstream 확인
