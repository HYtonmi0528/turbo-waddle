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

## 数据位置

用户模板、数据库、草稿和备份保存在 Electron `userData` 目录，不会写入安装目录，也不会包含在安装包和 Git 仓库中。
