# src/tools/ - 16개 디렉토리에 걸친 26개 도구

**생성일:** 2026-04-18

## 개요

`createToolRegistry()`를 통해 등록된 26개 도구. 두 가지 패턴: 19개 도구는 팩토리 함수(`createXXXTool`), 7개(LSP + interactive_bash)는 직접 `ToolDefinition`.

## 도구 카탈로그

### 태스크 관리 (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `task_create` | `createTaskCreateTool` | subject, description, blockedBy, blocks, metadata, parentID |
| `task_list` | `createTaskList` | (none) |
| `task_get` | `createTaskGetTool` | id |
| `task_update` | `createTaskUpdateTool` | id, subject, description, status, addBlocks, addBlockedBy, owner, metadata |

### 위임 (1)

| Tool | Factory | Parameters |
|------|---------|------------|
| `task` | `createDelegateTask` | description, prompt, category, subagent_type, run_in_background, session_id, load_skills, command |

**8개 내장 카테고리**: visual-engineering, ultrabrain, deep, artistry, quick, unspecified-low, unspecified-high, writing

### 에이전트 호출 (1)

| Tool | Factory | Parameters |
|------|---------|------------|
| `call_omo_agent` | `createCallOmoAgent` | description, prompt, subagent_type, run_in_background, session_id |

### 백그라운드 태스크 (2)

| Tool | Factory | Parameters |
|------|---------|------------|
| `background_output` | `createBackgroundOutput` | task_id, block, timeout, full_session, include_thinking, message_limit, since_message_id, thinking_max_chars |
| `background_cancel` | `createBackgroundCancel` | taskId, all |

### LSP 리팩토링 (6) - 직접 ToolDefinition

| Tool | Parameters |
|------|------------|
| `lsp_goto_definition` | filePath, line, character |
| `lsp_find_references` | filePath, line, character, includeDeclaration |
| `lsp_symbols` | filePath, scope (document/workspace), query, limit |
| `lsp_diagnostics` | filePath, severity |
| `lsp_prepare_rename` | filePath, line, character |
| `lsp_rename` | filePath, line, character, newName |

### 코드 검색 (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `ast_grep_search` | `createAstGrepTools` | pattern, lang, paths, globs, context |
| `ast_grep_replace` | `createAstGrepTools` | pattern, rewrite, lang, paths, globs, dryRun |
| `grep` | `createGrepTools` | pattern, path, include (60s 타임아웃, 10MB 한계) |
| `glob` | `createGlobTools` | pattern, path (60s 타임아웃, 100 파일 한계) |

### 세션 히스토리 (4)

| Tool | Factory | Parameters |
|------|---------|------------|
| `session_list` | `createSessionManagerTools` | (none) |
| `session_read` | `createSessionManagerTools` | session_id, include_todos, limit |
| `session_search` | `createSessionManagerTools` | query, session_id, case_sensitive, limit |
| `session_info` | `createSessionManagerTools` | session_id |

### 스킬/명령 (2)

| Tool | Factory | Parameters |
|------|---------|------------|
| `skill` | `createSkillTool` | name, user_message |
| `skill_mcp` | `createSkillMcpTool` | mcp_name, tool_name/resource_name/prompt_name, arguments, grep |

### 시스템 (2)

| Tool | Factory | Parameters |
|------|---------|------------|
| `interactive_bash` | Direct | tmux_command |
| `look_at` | `createLookAt` | file_path, image_data, goal |

### 편집 (1) - 조건부

| Tool | Factory | Parameters |
|------|---------|------------|
| `hashline_edit` | `createHashlineEditTool` | file, edits[] |

## 위임 카테고리

| 카테고리 | 모델 | 도메인 |
|----------|-------|--------|
| visual-engineering | gemini-3.1-pro high | 프론트엔드, UI/UX |
| ultrabrain | gpt-5.5 xhigh | 어려운 로직 |
| deep | gpt-5.5 medium | 자율 문제 해결 |
| artistry | gemini-3.1-pro high | 창의적 접근 |
| quick | gpt-5.4-mini | 사소한 태스크 |
| unspecified-low | claude-sonnet-4-6 | 중간 정도의 노력 |
| unspecified-high | claude-opus-4-7 max | 높은 노력 |
| writing | gemini-3-flash | 문서 작성 |

## 도구 추가 방법

1. 팩토리를 export하는 `src/tools/{name}/index.ts` 생성
2. 파라미터 스키마를 위한 `src/tools/{name}/types.ts` 생성
3. 구현을 위한 `src/tools/{name}/tools.ts` 생성
4. `src/plugin/tool-registry.ts`에 등록
