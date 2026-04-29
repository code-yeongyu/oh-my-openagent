# src/shared/ — 100개 이상의 유틸리티 파일

**생성일:** 2026-04-18

## 개요

플러그인 전체에서 사용되는 횡단(cross-cutting) 유틸리티. `index.ts`에서 barrel export됨. 로거는 `/tmp/oh-my-opencode.log`에 기록.

## 카테고리 맵

| 카테고리 | 파일 수 | 주요 export |
|----------|-------|-------------|
| **Model Resolution** | ~22 | `resolveModel()`, `checkModelAvailability()`, `AGENT_MODEL_REQUIREMENTS` |
| **Tmux Integration** | 11 | `createTmuxSession()`, `spawnPane()`, `closePane()`, 서버 헬스 |
| **Configuration & Paths** | 10 | `resolveOpenCodeConfigDir()`, `getDataPath()`, `parseJSONC()` |
| **Session Management** | 8 | `SessionCursor`, `trackInjectedPath()`, `SessionToolsStore` |
| **Git Worktree** | 7 | `parseGitStatusPorcelain()`, `collectGitDiffStats()`, `formatFileChanges()` |
| **Command Execution** | 7 | `executeCommand()`, `executeHookCommand()`, 임베디드 명령 레지스트리 |
| **Migration** | 6 | `migrateConfigFile()`, AGENT_NAME_MAP, HOOK_NAME_MAP, MODEL_VERSION_MAP |
| **String & Tool Utils** | 6 | `toSnakeCase()`, `normalizeToolName()`, `parseFrontmatter()` |
| **Agent Configuration** | 5 | `getAgentVariant()`, `AGENT_DISPLAY_NAMES`, `AGENT_TOOL_RESTRICTIONS` |
| **OpenCode Integration** | 5 | `injectServerAuth()`, `detectExternalPlugins()`, 클라이언트 accessor |
| **Type Helpers** | 4 | `deepMerge()`, `DynamicTruncator`, `matchPattern()`, `isRecord()` |
| **기타** | 8 | `log()`, `readFile()`, `extractZip()`, `downloadBinary()`, `findAvailablePort()` |

## 모델 해석 파이프라인

```
resolveModel(input)
  1. Override: UI에서 선택된 모델 (primary 에이전트만)
  2. Category default: 카테고리 설정에서
  3. Provider fallback: AGENT_MODEL_REQUIREMENTS chain
  4. System default: 최종 fallback
```

주요 파일: `model-resolver.ts` (진입점), `model-resolution-pipeline.ts` (오케스트레이션), `model-requirements.ts` (fallback chain), `model-availability.ts` (fuzzy 매칭).

## 마이그레이션 시스템

로드 시 레거시 설정을 자동 변환:
- `agent-names.ts`: 옛 에이전트 이름 → 새 이름 (예: `junior` → `sisyphus-junior`)
- `hook-names.ts`: 옛 훅 이름 → 새 이름
- `model-versions.ts`: 옛 모델 ID → 현재 ID
- `agent-category.ts`: 레거시 에이전트 설정 → 카테고리 시스템

## 가장 많이 import되는 항목

| 유틸리티 | Import 수 | 목적 |
|---------|-------------|---------|
| `logger.ts` | 62 | `/tmp/oh-my-opencode.log` |
| `data-path.ts` | 11 | XDG 스토리지 해석 |
| `model-requirements.ts` | 11 | 에이전트 fallback chain |
| `system-directive.ts` | 11 | 시스템 메시지 필터링 |
| `frontmatter.ts` | 10 | YAML 메타데이터 추출 |
