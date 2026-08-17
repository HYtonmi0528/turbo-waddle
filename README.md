# 智能 Excel 表格生成器

Windows 桌面应用，用于管理 Excel 模板、配置字段映射、录入询价及供应商资料，并生成格式化工作簿。

## 主要功能

- 导入、创建和编辑 Excel 模板
- 自定义系统字段与字段映射
- 分类批次录入、方向键导航和多单元格粘贴
- PDF、文档和图片附件输出
- 美元成本、汇率和发票类型换算
- 未完成录入草稿自动保存与恢复
- SQLite 数据库迁移、每日备份及安全恢复
- GitHub Release 在线更新与静默自动安装

## 本地开发

```powershell
pnpm install
pnpm run build:renderer
pnpm start
```

运行测试：

```powershell
pnpm test
```

生成 Windows 安装包：

```powershell
pnpm run build:win
```

## 国内协作数据库

数据库表、业务关系、外部询价接收接口和文件留存规则见：

[`docs/database-dictionary.md`](docs/database-dictionary.md)

海外端目前只需要调用 `POST /api/external/rfqs` 提交询价 Excel；国内管理员在“外部接收箱”确认后，系统才会生成协作任务。

询价 Excel 支持多个工作表，也支持同一工作表中连续放置多个“表头 + 产品明细”表格；导入时会识别所有表格，导出时按原工作表和表头位置回填。

## 数据位置

用户模板、数据库、草稿和备份保存在 Electron `userData` 目录，不会写入安装目录，也不会包含在安装包和 Git 仓库中。

## 局域网测试

管理员电脑启动 `npm run server` 后，服务绑定 `0.0.0.0:3210`，终端会打印局域网访问地址。其他电脑与管理员电脑连接同一网络后，在程序连接页面填写该地址，例如 `http://192.168.1.100:3210`。首次使用需要在管理员电脑完成 MySQL 初始化和管理员账号创建；Windows 防火墙需要允许 TCP 3210 入站。后续上云时只需替换客户端连接地址、数据库和文件存储配置。

网页测试可直接双击 `start-web.bat`。它只启动 Node 网页服务并打开浏览器，不启动 Electron。其他电脑访问管理员电脑打印的局域网地址即可。
