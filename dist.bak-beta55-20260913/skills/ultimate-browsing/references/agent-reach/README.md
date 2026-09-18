
# Agent Reach — 路由器

> Part of the **ultimate-browsing** skill (Tier 1.5). Routing and tier-escalation live in [../../SKILL.md](../../SKILL.md).
> Per-category guides in this folder: [search.md](search.md) · [social.md](social.md) · [career.md](career.md) · [dev.md](dev.md) · [web.md](web.md) · [video.md](video.md).


17 平台工具集合。根据用户意图选择对应分类。

## 路由表

| 用户意图 | 分类 | 详细文档 |
|---------|------|---------|
| 网页搜索/代码搜索 | search | [search.md](search.md) |
| 小红书/抖音/微博/推特/B站/V2EX/Reddit | social | [social.md](social.md) |
| 招聘/职位/LinkedIn | career | [career.md](career.md) |
| GitHub/代码 | dev | [dev.md](dev.md) |
| 网页/文章/公众号/RSS | web | [web.md](web.md) |
| YouTube/B站/播客字幕 | video | [video.md](video.md) |

## 零配置快速命令

```bash
# Exa 网页搜索
mcporter call 'exa.web_search_exa(query: "query", numResults: 5)'

# 通用网页阅读
curl -s "https://r.jina.ai/URL"

# GitHub 搜索
gh search repos "query" --sort stars --limit 10

# Twitter 搜索
twitter search "query" --limit 10

# YouTube/B站字幕
yt-dlp --write-sub --skip-download -o "/tmp/%(id)s" "URL"

# Reddit 搜索
rdt search "query" --limit 10

# Reddit 读帖 + 评论
rdt read POST_ID

# V2EX 热门
curl -s "https://www.v2ex.com/api/topics/hot.json" -H "User-Agent: agent-reach/1.0"
```

## 环境检查

```bash
# 检查可用 channel
agent-reach doctor

# 查看所有 MCP 服务
mcporter_list_servers()
```

## 工作区规则

**不要在 agent workspace 创建文件。** 使用 `/tmp/` 存放临时输出。

## 详细文档

根据用户需求，阅读对应的详细文档：

- [搜索工具](search.md) — Exa AI 搜索
- [社交媒体](social.md) — 小红书, 抖音, Twitter, B站, V2EX, Reddit
- [职场招聘](career.md) — LinkedIn
- [开发工具](dev.md) — GitHub CLI
- [网页阅读](web.md) — Jina Reader, 微信公众号, RSS
- [视频播客](video.md) — YouTube, B站, 小宇宙

## 配置渠道

如果某个 channel 需要配置，获取安装指南：
https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/install.md

用户只需提供 cookies，其他配置由 agent 完成。
