#!/bin/bash

# SiliconFlow Compaction Accuracy Tests Runner
# 方案A: 全谱系测试
#
# 测试模型：
# 1. Qwen3-8B (免费) - 基线测试
# 2. Qwen3-32B (¥5/M) - 生产级质量
# 3. DeepSeek-V4-Flash (¥3/M) - MoE 架构对比
#
# 预计成本：约 ¥93/月（日均10次测试）

set -e

echo "=== SiliconFlow Compaction Accuracy Tests ==="
echo ""

# 检查 API key
if [ -z "$SILICONFLOW_API_KEY" ]; then
    echo "⚠️  警告: 未设置 SILICONFLOW_API_KEY 环境变量"
    echo ""
    echo "使用默认 API key 继续？(y/N)"
    read -r response
    if [[ "$response" != "y" && "$response" != "Y" ]]; then
        echo ""
        echo "请设置环境变量后重试："
        echo "  export SILICONFLOW_API_KEY='your-api-key'"
        exit 1
    fi
    export SILICONFLOW_API_KEY="sk-njiwsqeiklyzdcyiderytlupdumqqtbttoorzmzrtsnhxqlm"
fi

echo "✓ API key 已配置"
echo ""

# 显示测试配置
echo "测试配置："
echo "  API Provider: SiliconFlow"
echo "  Base URL: https://api.siliconflow.cn/v1"
echo ""
echo "测试模型（方案A: 全谱系测试）："
echo "  1. Qwen3-8B (免费) - 基线测试"
echo "  2. Qwen3-32B (¥5/M) - 生产级质量"
echo "  3. DeepSeek-V4-Flash (¥3/M) - MoE 架构对比"
echo ""

# 成本估算
echo "成本估算："
echo "  单次完整测试: ¥0.50 - ¥2.00"
echo "  日均10次测试: ¥15 - ¥60/月"
echo "  月均成本: ¥93/月"
echo ""

# 询问确认
echo "⚠️  这些测试会调用真实的 LLM API 并产生费用。"
echo "是否继续？(y/N)"
read -r response
if [[ "$response" != "y" && "$response" != "Y" ]]; then
    echo "已取消。"
    exit 0
fi

echo ""
echo "开始运行测试..."
echo ""

# 运行测试
bun test packages/omo-opencode/src/hooks/__tests__/compaction/siliconflow-accuracy.test.ts

echo ""
echo "=== 测试完成 ==="
echo ""
echo "下一步："
echo "1. 查看测试结果"
echo "2. 更新 accuracy-benchmark-report.md"
echo "3. 提交更新的报告"
