$ErrorActionPreference = 'Stop'
$appDir = if ($env:LATIC_RFQ_APP_DIR) { $env:LATIC_RFQ_APP_DIR } else { Split-Path -Parent $PSScriptRoot }
$branch = if ($env:LATIC_RFQ_BRANCH) { $env:LATIC_RFQ_BRANCH } else { 'agent/document-center' }
Set-Location $appDir

Write-Host '[1/5] 拉取最新代码'
git fetch origin $branch
git checkout $branch
git pull --ff-only origin $branch
Write-Host '[2/5] 安装依赖'
npm install
Write-Host '[3/5] 构建网页资源'
npm run build:renderer
Write-Host '[4/5] 重启服务'
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 restart latic-rfq --update-env
  if ($LASTEXITCODE -ne 0) { pm2 start server/index.js --name latic-rfq --max-memory-restart 500M }
  pm2 save
} else { throw '未找到 PM2，请先执行 npm install -g pm2' }
Write-Host '[5/5] 检查服务'
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3210/ -Method Head | Out-Null
Write-Host '更新完成，请刷新浏览器（Ctrl+F5）。'
