CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  password_hash CHAR(128) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  role ENUM('admin', 'employee') NOT NULL DEFAULT 'employee',
  status ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
