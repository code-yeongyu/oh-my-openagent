# src/cli/config-manager/ — CLI 설치 유틸리티

**생성일:** 2026-04-11

## 개요

20개 파일. `install` 명령용 무상태(stateless) 유틸리티 함수들. OpenCode 설정 조작, 프로바이더 구성, JSONC 작업, 바이너리 감지, npm 레지스트리 쿼리를 담당. 클래스가 없는 평면(flat) 유틸리티 모음.

## 파일 카탈로그

| 파일 | 목적 |
|------|---------|
| `add-plugin-to-opencode-config.ts` | `.opencode/opencode.json`의 plugin 배열에 `oh-my-opencode` 등록 |
| `add-provider-config.ts` | OpenCode 설정 (사용자 레벨)에 프로바이더 API 키 추가 |
| `antigravity-provider-configuration.ts` | Antigravity 프로바이더 설정 처리 (특수 케이스) |
| `auth-plugins.ts` | 프로바이더별 auth 플러그인 요구사항 감지 (oauth vs key) |
| `bun-install.ts` | 플러그인 설정용 `bun install` / `npm install` 실행 |
| `config-context.ts` | `ConfigContext` — 설치 단계 간 공유 설정 상태 |
| `deep-merge-record.ts` | JSONC 설정 객체용 Deep merge 유틸리티 |
| `detect-current-config.ts` | 기존 OpenCode 설정 읽기, 설치된 플러그인 감지 |
| `ensure-config-directory-exists.ts` | `.opencode/` 디렉토리가 없으면 생성 |
| `format-error-with-suggestion.ts` | 실행 가능한 제안과 함께 에러 포매팅 |
| `generate-omo-config.ts` | 설치 선택값에서 `oh-my-opencode.jsonc` 생성 |
| `jsonc-provider-editor.ts` | 주석을 보존하는 JSONC 파일 읽기/쓰기 |
| `npm-dist-tags.ts` | npm 레지스트리에서 최신 버전 가져오기 (dist-tags) |
| `opencode-binary.ts` | OpenCode 바이너리 위치 감지, 설치 여부 검증 |
| `opencode-config-format.ts` | OpenCode 설정 형식 상수 및 type guard |
| `parse-opencode-config-file.ts` | opencode.json/opencode.jsonc fallback 포함 파싱 |
| `plugin-name-with-version.ts` | 설치를 위한 `oh-my-opencode@X.Y.Z` 해석 |
| `write-omo-config.ts` | 생성된 설정을 `.opencode/oh-my-opencode.jsonc`에 쓰기 |

## 사용 패턴

함수들은 `src/cli/install.ts` / `src/cli/tui-installer.ts`에서 순차적으로 호출됨:

```
1. ensure-config-directory-exists
2. detect-current-config (이미 설정된 항목 확인)
3. opencode-binary (opencode 설치 검증)
4. npm-dist-tags (최신 버전 조회)
5. generate-omo-config (사용자 선택값으로 설정 빌드)
6. write-omo-config
7. add-plugin-to-opencode-config
8. add-provider-config (선택된 각 프로바이더에 대해)
9. bun-install
```

## 참고사항

- 모든 함수는 순수/무상태 (디스크 I/O 제외) — 공유 모듈 상태 없음
- `jsonc-provider-editor.ts`는 주석 보존 JSONC 라이브러리 사용 — JSONC 파일에 절대 `JSON.parse` 사용 금지
- `opencode-binary.ts`는 PATH + 일반 설치 위치(`.local/bin`, `~/.bun/bin` 등)를 검색
