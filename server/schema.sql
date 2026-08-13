CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  role ENUM('admin', 'manager', 'purchaser', 'viewer') NOT NULL DEFAULT 'viewer',
  status ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending',
  requested_role VARCHAR(40),
  registration_token_hash CHAR(64),
  department VARCHAR(120),
  phone VARCHAR(40),
  language VARCHAR(10) NOT NULL DEFAULT 'zh-CN',
  approved_by CHAR(36),
  approved_at DATETIME(3),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_templates (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(80) NOT NULL DEFAULT '通用',
  description TEXT,
  original_name VARCHAR(255),
  storage_path VARCHAR(600),
  structure_json JSON,
  mappings_json JSON,
  is_shared TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_templates_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  INDEX idx_templates_owner (owner_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_tasks (
  id CHAR(36) PRIMARY KEY,
  task_no VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  requester VARCHAR(120),
  country VARCHAR(120),
  client_name VARCHAR(180),
  request_date DATE,
  deadline DATETIME(3),
  import_type VARCHAR(100),
  delivery_type VARCHAR(160),
  payment_type VARCHAR(100),
  status ENUM('draft', 'published', 'in_progress', 'review', 'submitted', 'completed') NOT NULL DEFAULT 'draft',
  source_original_name VARCHAR(255),
  source_storage_path VARCHAR(600),
  assigned_user_ids JSON,
  metadata_json JSON,
  current_version INT NOT NULL DEFAULT 1,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_tasks_status_updated (status, updated_at),
  INDEX idx_tasks_created_by (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 海外端提交的询价单先进入接收箱，管理员确认后再生成 rfq_tasks。
-- 这样可以区分“外部已提交”和“国内已下发”的业务状态。
CREATE TABLE IF NOT EXISTS external_rfq_submissions (
  id CHAR(36) PRIMARY KEY,
  external_request_id VARCHAR(120),
  title VARCHAR(255) NOT NULL,
  requester VARCHAR(120),
  country VARCHAR(120),
  client_name VARCHAR(180),
  request_date DATE,
  deadline DATETIME(3),
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(600) NOT NULL,
  metadata_json JSON,
  parsed_items_json JSON,
  status ENUM('received', 'accepted', 'rejected') NOT NULL DEFAULT 'received',
  received_at DATETIME(3) NOT NULL,
  reviewed_at DATETIME(3),
  reviewed_by CHAR(36),
  rejection_reason TEXT,
  task_id CHAR(36),
  CONSTRAINT fk_external_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id),
  CONSTRAINT fk_external_task FOREIGN KEY (task_id) REFERENCES rfq_tasks(id) ON DELETE SET NULL,
  UNIQUE KEY uq_external_request_id (external_request_id),
  INDEX idx_external_status_received (status, received_at),
  INDEX idx_external_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 钉盘式资料中心：数据库保存元数据，文件本体保存在 storageDir，后续可替换为 OSS。
CREATE TABLE IF NOT EXISTS documents (
  id CHAR(36) PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(600) NOT NULL,
  mime_type VARCHAR(160),
  file_size BIGINT UNSIGNED NOT NULL DEFAULT 0,
  file_ext VARCHAR(20),
  category VARCHAR(80) NOT NULL DEFAULT 'other',
  entity_type VARCHAR(60),
  entity_id CHAR(36),
  archive_category VARCHAR(80),
  archive_date DATE,
  archive_folder VARCHAR(255),
  archive_name VARCHAR(255),
  visibility ENUM('all', 'department', 'private', 'admin') NOT NULL DEFAULT 'all',
  version_no INT NOT NULL DEFAULT 1,
  checksum CHAR(64),
  status ENUM('active', 'deleted') NOT NULL DEFAULT 'active',
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3),
  CONSTRAINT fk_documents_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_documents_search (status, category, created_at),
  INDEX idx_documents_entity (entity_type, entity_id, version_no),
  INDEX idx_documents_archive (archive_category, archive_date, archive_folder),
  INDEX idx_documents_name (original_name),
  INDEX idx_documents_creator (created_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rfq_items (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  line_no INT NOT NULL,
  description TEXT NOT NULL,
  quantity DECIMAL(18,4),
  unit VARCHAR(80),
  product_code VARCHAR(120),
  ltc VARCHAR(120),
  fob_usd DECIMAL(18,4),
  total_usd DECIMAL(18,4),
  total_rmb DECIMAL(18,4),
  exchange_rate DECIMAL(18,6),
  invoice_type VARCHAR(30),
  selected_supplier VARCHAR(255),
  selected_quote_json JSON,
  remarks TEXT,
  attachments_json JSON,
  source_json JSON,
  row_version INT NOT NULL DEFAULT 1,
  updated_by CHAR(36),
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_items_task FOREIGN KEY (task_id) REFERENCES rfq_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_editor FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE KEY uq_task_line (task_id, line_no),
  INDEX idx_items_task (task_id, line_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_snapshots (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  version_no INT NOT NULL,
  snapshot_json JSON NOT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_snapshots_task FOREIGN KEY (task_id) REFERENCES rfq_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_snapshots_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_task_snapshot_version (task_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  action VARCHAR(60) NOT NULL,
  before_json JSON,
  after_json JSON,
  user_id CHAR(36),
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_audit_entity (entity_type, entity_id, created_at),
  INDEX idx_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT,
  task_id CHAR(36),
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  read_at DATETIME(3),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_task FOREIGN KEY (task_id) REFERENCES rfq_tasks(id) ON DELETE CASCADE,
  INDEX idx_notifications_unread (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_entries (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  type VARCHAR(100) NOT NULL,
  data JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_entries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_entries_user_type (user_id, type, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS generation_history (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  template_id CHAR(36),
  template_name VARCHAR(200),
  data_summary JSON,
  file_path VARCHAR(600),
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_history_user_date (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_system_fields (
  field_key VARCHAR(80) PRIMARY KEY,
  label VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(80) DEFAULT '自定义字段',
  data_type VARCHAR(30) NOT NULL DEFAULT 'text',
  created_by CHAR(36),
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_fields_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS data_entry_drafts (
  id VARCHAR(120) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  template_id VARCHAR(80) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_drafts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_drafts_user (user_id, template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  user_id CHAR(36) NOT NULL,
  setting_key VARCHAR(120) NOT NULL,
  setting_value TEXT,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, setting_key),
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_sets (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(200) NOT NULL,
  project_id CHAR(36),
  options_json JSON,
  field_labels_json JSON,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_quotes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_quotes_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quote_items (
  id CHAR(36) PRIMARY KEY,
  quote_set_id CHAR(36) NOT NULL,
  item_index INT NOT NULL,
  supplier_name VARCHAR(255),
  model VARCHAR(200),
  reference VARCHAR(200),
  description TEXT,
  price DECIMAL(18,4),
  total_price DECIMAL(18,4),
  total_rmb DECIMAL(18,4),
  notes TEXT,
  after_sales TEXT,
  data_json JSON,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_qitems_set FOREIGN KEY (quote_set_id) REFERENCES quote_sets(id) ON DELETE CASCADE,
  INDEX idx_qitems_set (quote_set_id, item_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_comments (
  id CHAR(36) PRIMARY KEY,
  task_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES rfq_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_comments_task (task_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
