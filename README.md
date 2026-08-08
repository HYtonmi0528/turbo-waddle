# LATIC v2 业务流程说明

## 完整询价流程

### 1. 接收询价
- 海外业务员通过邮件/前端 ↓ 发送询价表(Excel) 
- 管理员登录 → 共享询价任务 → 点击「上传并下发询价单」
- 系统自动解析 Excel(多sheet, 中西文字段), 提取产品明细
- 存入 MySQL rfq_tasks + rfq_items 表

### 2. 下发任务
- 管理员指定负责人(assignedUserIds)
- 状态变为 published
- 所有员工收到通知

### 3. 员工填写
- 员工登录 → 共享询价任务 → 打开任务
- 每行产品填写: FOB(USD), 含税运人民币, 发票类型(专票/普票), 备注
- 支持 Ctrl+S 快速保存
- 支持「还原」到上个版本
- 支持上传附件(图片/PDF/文档)

### 4. 供应商报价匹配
- 员工去 Excel工具 → 选择模板 → 录入各供应商报价 → 生成对比表
- 系统自动保存为「报价集」(MySQL quote_sets 表)
- 回到任务详情 → 选择报价集 → 「从表格勾选」
- 弹窗显示候选人(按价格排名: 最低/第2/#3)
- 点击「选用」自动填入 FOB + 含税价 + 供应商名

### 5. 导出询价单
- 管理员可导出已填写的询价单(Excel)
- 所有生成文件保存到 server-data/files/tasks/{taskId}/
- 支持 CSV 导出

### 6. 云端部署
- MySQL 部署在云服务器(docker/直接安装)
- Python FastAPI 部署在云服务器
- 前端构建后 Nginx 托管或 CDN
- 员工通过公网 IP/域名访问
- 文件存储: server-data/files/ (可配置对象存储)

## API 接口

BASE: http://服务器IP:3210

认证: POST /api/auth/login → JWT Token → Authorization: Bearer {token}

见 /docs 自动生成的 Swagger 文档
