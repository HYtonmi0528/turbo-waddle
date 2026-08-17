#!/usr/bin/env bash
set -euo pipefail

# Usage: cd ~/apps/latic-rfq && bash scripts/update-server.sh
APP_DIR="${LATIC_RFQ_APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${LATIC_RFQ_BRANCH:-agent/document-center}"
cd "$APP_DIR"

echo "[1/5] 拉取 $BRANCH 最新代码"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "[2/5] 安装依赖"
# 云服务器只运行 Web/Node 服务，不需要下载 Electron 桌面运行时。
# 跳过安装脚本可避免国内网络访问 Electron CDN 时出现 socket hang up。
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install --ignore-scripts

echo "[3/5] 构建网页资源"
npm run build:renderer

echo "[4/5] 重启服务"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart latic-rfq --update-env || pm2 start server/index.js --name latic-rfq --max-memory-restart 500M
  pm2 save
else
  echo "未找到 PM2，请先执行：npm install -g pm2"
  exit 1
fi

echo "[5/5] 检查服务"
curl --fail --silent --show-error -I http://127.0.0.1:3210/ >/dev/null
echo "更新完成，请刷新浏览器（Ctrl+F5）。"
