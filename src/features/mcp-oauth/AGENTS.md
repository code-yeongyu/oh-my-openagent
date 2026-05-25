# src/features/mcp-oauth/ — MCP 服务器的 OAuth 2.0 + PKCE + DCR

**生成时间:** 2026-05-15

## 概述

18 个文件。为需要认证的 MCP 服务器提供完整的 OAuth 2.0 授权流程。实现了 PKCE（RFC 7636）、动态客户端注册（DCR，RFC 7591）和资源指示符（RFC 8707）。由 `bunx oh-my-opencode mcp-oauth login` 使用。

## 授权流程

```
1. discovery.ts → 获取 /.well-known/oauth-authorization-server
2. dcr.ts → 动态客户端注册（如果服务器支持）
3. oauth-authorization-flow.ts → 生成 PKCE verifier/challenge
4. callback-server.ts → 在随机端口启动本地 HTTP 服务器用于重定向
5. 打开浏览器 → 授权 URL
6. callback-server.ts → 接收 code + state
7. provider.ts → 用 PKCE verifier 交换令牌
8. storage.ts → 持久化令牌到 ~/.config/opencode/mcp-oauth/
9. step-up.ts → 处理初始令牌不足时的升级认证
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `oauth-authorization-flow.ts` | PKCE 辅助函数：`generateCodeVerifier()`、`generateCodeChallenge()`、`buildAuthorizationUrl()` |
| `callback-server.ts` | 本地 HTTP 重定向服务器 — 监听 OAuth 回调 |
| `provider.ts` | `OAuthProvider` — 令牌交换、刷新、撤销 |
| `discovery.ts` | 从 well-known 端点获取并解析 OAuth 服务器元数据 |
| `dcr.ts` | 动态客户端注册 — 向 OAuth 服务器注册此应用 |
| `resource-indicator.ts` | RFC 8707 资源指示符处理 |
| `step-up.ts` | 处理升级认证挑战 |
| `storage.ts` | 持久化令牌到 `~/.config/opencode/mcp-oauth/{server-hash}.json` |
| `schema.ts` | OAuth 服务器元数据、令牌响应、DCR 的 Zod 模式 |

## PKCE 实现

- 代码验证器：32 随机字节 → base64url（无填充）
- 代码挑战：SHA-256(验证器) → base64url
- 方法：`S256`

## 令牌存储

位置：`~/.config/opencode/mcp-oauth/` — 每个 MCP 服务器一个 JSON 文件（按服务器 URL 哈希键控）。
字段：`access_token`、`refresh_token`、`expires_at`、`client_id`。

## CLI 命令

```bash
bunx oh-my-opencode mcp-oauth login <server-url>   # 完整 PKCE 流程
bunx oh-my-opencode mcp-oauth logout <server-url>  # 撤销 + 删除令牌
bunx oh-my-opencode mcp-oauth status               # 列出已存储的令牌
```
