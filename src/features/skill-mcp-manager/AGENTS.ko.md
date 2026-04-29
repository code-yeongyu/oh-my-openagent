# src/features/skill-mcp-manager/ — Skill-Embedded MCP 클라이언트 라이프사이클

**생성일:** 2026-04-11

## 개요

18개 파일. MCP 시스템의 **tier 3** 관리: SKILL.md YAML frontmatter 에 선언된 skill-embedded MCP 서버. 세션별 클라이언트 격리, 듀얼 트랜스포트 (stdio + HTTP), step-up 인증을 갖춘 OAuth 2.0, idle 정리.

## 3-TIER MCP 컨텍스트

| Tier | 매니저 | 스코프 |
|------|---------|-------|
| 1. Built-in | `createBuiltinMcps()` (src/mcp/) | 글로벌, 3개 원격 HTTP |
| 2. Claude Code | `claude-code-mcp-loader` (src/features/) | `.mcp.json` 에서 |
| 3. **Skill-embedded** | **`SkillMcpManager` (이 모듈)** | **세션별, SKILL.md YAML 에서** |

## 클라이언트 키 형식

```
${sessionID}:${skillName}:${serverName}
```

활성화: 세션별 격리, 동일 스킬을 여러 세션에서 동시 사용 가능, 스킬당 다중 서버.

## 듀얼 트랜스포트

| 타입 | 파일 | 백엔드 |
|------|------|---------|
| **stdio** | `stdio-client.ts` | `StdioClientTransport` (로컬 프로세스) |
| **http** | `http-client.ts` | `StreamableHTTPClientTransport` (원격) |

**감지** (connection-type.ts): 명시적 `type` 필드 → URL 존재 → command 존재. 레거시 `"sse"` 는 http 로 매핑.

## 상태

```typescript
interface SkillMcpManagerState {
  clients: Map<clientKey, ManagedClient>              // 활성 연결
  pendingConnections: Map<clientKey, Promise<Client>> // 레이스 방지
  disconnectedSessions: Map<sessionID, generation>    // stale 연결 감지
  authProviders: Map<url, OAuthProvider>              // 서버별 OAuth 상태
  inFlightConnections: Map<sessionID, count>          // 연결 카운팅
}
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `manager.ts` | `SkillMcpManager` 클래스 — 메인 API (getOrCreateClient, disconnectSession, listTools, callTool 등) |
| `types.ts` | `ManagedStdioClient`, `ManagedHttpClient`, `SkillMcpManagerState`, `ConnectionType` |
| `connection.ts` | 레이스 방지, 재시도, 환경변수 확장이 포함된 클라이언트 팩토리 |
| `connection-type.ts` | 설정에서 stdio vs http 감지 (레거시 sse → http) |
| `stdio-client.ts` | Stdio 트랜스포트 팩토리 |
| `http-client.ts` | HTTP 트랜스포트 팩토리 |
| `cleanup.ts` | SIGINT/SIGTERM 핸들러, idle 타이머 (60초 간격, 5분 TTL) |
| `oauth-handler.ts` | OAuth 토큰 관리, 갱신, step-up (403 스코프 에스컬레이션) |
| `env-cleaner.ts` | npm/pnpm/yarn 설정 + 25개 이상의 시크릿 패턴 (_KEY, _SECRET, _TOKEN) 필터링 |
| `error-redaction.ts` | 로그 전 에러 메시지에서 민감한 데이터 마스킹 |

## 라이프사이클 통합

**훅**: `src/plugin/event.ts` 의 `session.deleted`:
```typescript
await managers.skillMcpManager.disconnectSession(sessionInfo.id)
```

## 라이프사이클 흐름

```
1. session.created      → 액션 없음 (지연 연결)
2. 첫 MCP 도구 호출      → getOrCreateClient() 가 생성 + 캐시
3. 사용 지속            → lastUsedAt 타임스탬프 업데이트
4. 5분 이상 idle         → 정리 타이머가 제거
5. session.deleted      → disconnectSession() 이 세션 클라이언트 종료
6. 프로세스 종료         → SIGINT/SIGTERM 핸들러를 통한 disconnectAll()
```

## 레이스 컨디션 방지

- **pendingConnections**: 동일 키에 대한 동시 연결 시도 중복 제거
- **inFlightConnections**: 세션별 카운터, 연결 셋업 중 조기 정리 방지
- **shutdownGeneration**: 연결 해제 후 카운터 기반 stale 연결 감지

## 공개 API

```typescript
class SkillMcpManager {
  constructor(options?: { createOAuthProvider? })
  getOrCreateClient(info, config): Promise<Client>
  disconnectSession(sessionID): Promise<void>
  disconnectAll(): Promise<void>
  listTools/Resources/Prompts(info, context): Promise<...[]>
  callTool(info, context, name, args): Promise<unknown>
  readResource(info, context, uri): Promise<unknown>
  getPrompt(info, context, name, args): Promise<unknown>
  getConnectedServers(): string[]
  isConnected(info): boolean
}
```

## 재시도 시맨틱

- `getOrCreateClientWithRetry()` — 실패 시 강제 재연결로 3회 시도
- `withOperationRetry()` — OAuth 인지 래퍼: 403 시 step-up, 401 시 토큰 갱신

## 보안

- **env-cleaner.ts** — stdio 스폰 전에 npm/pnpm 설정 변수 (pnpm 프로젝트 격리 이슈 방지) 와 시크릿 패턴 제거
- **error-redaction.ts** — logger.log 전에 에러 메시지의 토큰/시크릿 마스킹
- **OAuth 격리** — auth provider 가 서버 URL 로 키 지정되며, 토큰이 서버 간 교차되지 않음
