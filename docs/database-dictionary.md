# LATIC 询价协作系统数据库说明

本文档说明国内协作端当前使用的 MySQL 数据库。客户端、未来海外端和管理员工具都应通过 API 访问数据库，不应直接暴露 MySQL 端口。

## 业务主链路

```text
external_rfq_submissions  海外端提交的询价表接收箱
          │ 管理员接受
          ▼
rfq_tasks                 国内协作任务
          │
          └── rfq_items   任务中的产品明细

quote_sets                供应商报价对比表
          └── quote_items 供应商报价明细

rfq_items.selected_quote_json  保存中选供应商快照
rfq_items.attachments_json     保存该产品的附件元数据
```

## 表说明

| 表名 | 一行代表什么 | 主要用途 |
| --- | --- | --- |
| `users` | 一个系统账号 | 管理员、经理、采购员、查看者 |
| `sessions` | 一次登录会话 | 保存登录令牌和过期时间 |
| `external_rfq_submissions` | 海外端提交的一张询价表 | 接收箱；管理员接受后生成 `rfq_tasks` |
| `rfq_tasks` | 一张国内询价任务 | 保存任务编号、国家、客户、请求人、截止时间和状态 |
| `rfq_items` | 任务中的一条产品 | 保存产品描述、数量、FOB、总价、备注、选中供应商 |
| `quote_sets` | 一份供应商报价集合 | 保存一次供应商对比表 |
| `quote_items` | 报价集合中的一条供应商报价 | 保存供应商、型号、价格、含税运价格和备注 |
| `user_templates` | 一个用户创建的模板 | 保存个人模板、共享模板和字段映射 |
| `custom_system_fields` | 一个自定义系统字段 | 支持不同业务类型的字段映射 |
| `data_entries` | 一条本地/个人录入数据 | 供应商和产品历史数据 |
| `data_entry_drafts` | 一个录入草稿 | 自动保存未完成的数据 |
| `task_snapshots` | 一次正式提交快照 | 保存任务某个版本的完整状态 |
| `audit_logs` | 一次业务操作 | 记录谁在什么时候做了什么修改 |
| `notifications` | 一条用户通知 | 新任务、审核、退回等提醒 |
| `task_comments` | 一条任务评论 | 协作讨论和补充说明 |
| `generation_history` | 一次文件生成记录 | 保存模板、生成文件和生成时间 |
| `app_settings` | 一个用户设置 | 汇率等应用配置 |

## 状态定义

### `external_rfq_submissions.status`

- `received`：海外端已提交，等待国内管理员处理
- `accepted`：管理员已接受并生成国内任务
- `rejected`：管理员拒绝，原因保存在 `rejection_reason`

### `rfq_tasks.status`

- `draft`：草稿
- `published`：已下发给国内团队
- `in_progress`：员工填写中
- `review`：等待管理员审核
- `submitted`：已生成正式版本
- `completed`：任务完成

## 文件留存规则

数据库保存文件的名称、路径、类型、所属任务和上传人；实际文件保存于服务器文件目录。

```text
server-data/files/external-rfqs/{submissionId}/原始询价表.xlsx
server-data/files/tasks/{taskId}/原始询价表.xlsx
server-data/files/tasks/{taskId}/attachments/*
```

未来迁移云端时，可以将上述文件目录替换为阿里云 OSS 或 MinIO，而不改变业务表结构。

## 外部提交接口

海外端只拥有提交权限，不拥有国内任务读取、员工账号或 SQL 权限。

```http
POST /api/external/rfqs
Header: X-LATIC-External-Key: <服务器生成的外部接收密钥>
Content-Type: multipart/form-data
file: 询价表.xlsx
title: 可选任务名称
externalRequestId: 外部系统编号
requester: 请求人
country: 国家
client: 客户
deadline: 截止时间
```

提交成功后返回 `submissionId` 和 `status=received`。管理员接受后调用：

```http
POST /api/external/rfqs/{submissionId}/accept
```

拒绝时调用：

```http
POST /api/external/rfqs/{submissionId}/reject
```

## 安全原则

1. MySQL 只允许 API 服务访问。
2. 普通用户不能执行任意 SQL。
3. 外部接收密钥只允许上传询价表。
4. 管理员接受外部询价后才生成国内协作任务。
5. 所有重要操作写入 `audit_logs`。
6. 文件和数据库分别备份。
# 资料中心补充说明

`documents` 是类似钉钉“钉盘”的统一资料目录。它只保存文件元数据，文件本体保存在服务端 storage 目录，后续可以替换为阿里云 OSS。

- `original_name`：用户看到的文件名
- `storage_path`：服务端内部路径，客户端不会直接读取
- `mime_type`、`file_size`、`file_ext`：文件类型和大小
- `category`：询价单、报价表、供应商资料、产品资料、任务附件、模板等
- `entity_type`、`entity_id`：关联询价任务、产品明细或外部接收记录
- `visibility`：全部员工、部门、本人或管理员可见
- `version_no`、`checksum`：版本号和完整性校验
- `status`：有效或已移入回收站

页面通过 `/api/documents` 搜索，通过 `/api/documents/:id/download` 下载；数据库和真实文件路径不对员工公开。
