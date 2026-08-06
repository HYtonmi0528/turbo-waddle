$ErrorActionPreference = 'Stop'

$mysqlServices = Get-Service -Name 'MySQL*','MariaDB*' -ErrorAction SilentlyContinue
$mysqlCommand = Get-Command mysql -ErrorAction SilentlyContinue

Write-Host '=== LATIC询价协作系统环境检查 ==='
Write-Host "电脑名称：$env:COMPUTERNAME"

$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress
Write-Host "局域网IPv4：$($addresses -join ', ')"

if ($mysqlServices) {
  $mysqlServices | Format-Table Name, Status, StartType
} else {
  Write-Warning '未检测到MySQL Windows服务。'
}

if ($mysqlCommand) {
  Write-Host "mysql命令：$($mysqlCommand.Source)"
} else {
  Write-Warning 'mysql命令尚未加入PATH。'
}

$port = Get-NetTCPConnection -State Listen -LocalPort 3306 -ErrorAction SilentlyContinue
if ($port) {
  Write-Host 'MySQL端口3306正在监听。'
} else {
  Write-Warning 'MySQL端口3306未监听。'
}

Write-Host '应用服务计划使用TCP 3210端口。MySQL 3306只供本机后台使用。'
