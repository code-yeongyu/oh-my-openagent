# src/features/mcp-oauth/ — MCP 서버용 OAuth 2.0 + PKCE + DCR

**생성일:** 2026-04-11

## 개요

18개 파일. 인증이 필요한 MCP 서버를 위한 완전한 OAuth 2.0 인가 플로우. PKCE (RFC 7636), Dynamic Client Registration (DCR, RFC 7591), resource indicators (RFC 8707) 구현. `bunx oh-my-opencode mcp-oauth login` 에서 사용됨.

## 인가 플로우

```
1. discovery.ts → /.well-known/oauth-authorization-server 페치
2. dcr.ts → Dynamic Client Registration (서버가 지원하는 경우)
3. oauth-authorization-flow.ts → PKCE verifier/challenge 생성
4. callback-server.ts → 리다이렉트용 임의 포트의 로컬 HTTP 서버
5. 브라우저 열기 → 인가 URL
6. callback-server.ts → code + state 수신
7. provider.ts → 토큰을 위한 코드 교환 (PKCE verifier 사용)
8. storage.ts → ~/.config/opencode/mcp-oauth/ 에 토큰 영속화
9. step-up.ts → 초기 토큰이 부족할 경우 step-up 인증 처리
```

## 주요 파일

| 파일 | 목적 |
|------|---------|
| `oauth-authorization-flow.ts` | PKCE 헬퍼: `generateCodeVerifier()`, `generateCodeChallenge()`, `buildAuthorizationUrl()` |
| `callback-server.ts` | 로컬 HTTP 리다이렉트 서버 — OAuth 콜백 수신 대기 |
| `provider.ts` | `OAuthProvider` — 토큰 교환, 갱신, 폐기 |
| `discovery.ts` | well-known 엔드포인트에서 OAuth 서버 메타데이터 페치 + 파싱 |
| `dcr.ts` | Dynamic Client Registration — OAuth 서버에 이 앱을 등록 |
| `resource-indicator.ts` | RFC 8707 resource indicator 처리 |
| `step-up.ts` | Step-up 인증 챌린지 처리 |
| `storage.ts` | `~/.config/opencode/mcp-oauth/{server-hash}.json` 에 토큰 영속화 |
| `schema.ts` | OAuth 서버 메타데이터, 토큰 응답, DCR 용 Zod 스키마 |

## PKCE 구현

- Code verifier: 32 랜덤 바이트 → base64url (패딩 없음)
- Code challenge: SHA-256(verifier) → base64url
- 메서드: `S256`

## 토큰 저장

위치: `~/.config/opencode/mcp-oauth/` — MCP 서버당 하나의 JSON 파일 (서버 URL 해시로 키 지정).
필드: `access_token`, `refresh_token`, `expires_at`, `client_id`.

## CLI 명령

```bash
bunx oh-my-opencode mcp-oauth login <server-url>   # 전체 PKCE 플로우
bunx oh-my-opencode mcp-oauth logout <server-url>  # 토큰 폐기 + 삭제
bunx oh-my-opencode mcp-oauth status               # 저장된 토큰 목록
```
