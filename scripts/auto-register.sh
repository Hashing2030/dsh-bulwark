#!/usr/bin/env bash
# ========================================
# DSH Session Tag Manage - 自动注册脚本 (Linux/macOS)
# ========================================
# 用途：自动安装宿主端和客户端插件到 DSH profile
# 使用：在项目根目录执行 ./scripts/auto-register.sh
# ========================================
# 委托给跨平台 Node 主脚本，统一逻辑并保证幂等写入 client patch 条目
# ========================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 检查 node 是否可用
if ! command -v node &> /dev/null; then
    echo "[错误] 未找到 node 命令，请先安装 Node.js"
    exit 1
fi

# 委托给跨平台 Node 主脚本
node "$SCRIPT_DIR/auto-register.js"
