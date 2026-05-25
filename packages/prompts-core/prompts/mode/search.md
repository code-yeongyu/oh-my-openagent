[搜索模式]
最大化搜索效率。并行启动多个后台 Agent：
- explore Agent（代码库模式、文件结构、ast-grep）
- librarian Agent（远程仓库、官方文档、GitHub 示例）
加上直接工具：Grep、ripgrep（rg）、ast-grep（sg）
绝不在找到第一个结果后就停止 —— 要穷尽地搜索。
