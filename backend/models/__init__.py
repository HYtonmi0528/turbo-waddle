import uuid, datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, JSON, DECIMAL, Boolean, ForeignKey, Enum, Index
from sqlalchemy.orm import relationship
from database import Base

def uid(): return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=uid)
    username = Column(String(64), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    password_hash = Column(String(128), nullable=False)
    password_salt = Column(String(32), nullable=False)
    role = Column(Enum("admin","manager","purchaser","viewer"), default="viewer")
    status = Column(Enum("pending","active","disabled"), default="pending")
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Session(Base):
    __tablename__ = "sessions"
    token_hash = Column(String(64), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    expires_at = Column(DateTime(3), nullable=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)

class UserTemplate(Base):
    __tablename__ = "user_templates"
    id = Column(String(36), primary_key=True, default=uid)
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    name = Column(String(200), nullable=False)
    type = Column(String(80), default="通用")
    description = Column(Text)
    original_name = Column(String(255))
    storage_path = Column(String(600))
    structure_json = Column(JSON)
    mappings_json = Column(JSON)
    is_shared = Column(Boolean, default=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class RfqTask(Base):
    __tablename__ = "rfq_tasks"
    id = Column(String(36), primary_key=True, default=uid)
    task_no = Column(String(80), nullable=False)
    title = Column(String(255), nullable=False)
    requester = Column(String(120))
    country = Column(String(120))
    client_name = Column(String(180))
    request_date = Column(DateTime)
    deadline = Column(DateTime(3))
    import_type = Column(String(100))
    delivery_type = Column(String(160))
    payment_type = Column(String(100))
    status = Column(Enum("draft","published","in_progress","review","submitted","completed"), default="draft")
    source_original_name = Column(String(255))
    source_storage_path = Column(String(600))
    assigned_user_ids = Column(JSON)
    metadata_json = Column(JSON)
    current_version = Column(Integer, default=1)
    created_by = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class RfqItem(Base):
    __tablename__ = "rfq_items"
    id = Column(String(36), primary_key=True, default=uid)
    task_id = Column(String(36), ForeignKey("rfq_tasks.id", ondelete="CASCADE"), nullable=False)
    line_no = Column(Integer, nullable=False)
    description = Column(Text, nullable=False)
    quantity = Column(DECIMAL(18,4))
    unit = Column(String(80))
    product_code = Column(String(120))
    ltc = Column(String(120))
    fob_usd = Column(DECIMAL(18,4))
    total_usd = Column(DECIMAL(18,4))
    total_rmb = Column(DECIMAL(18,4))
    exchange_rate = Column(DECIMAL(18,6))
    invoice_type = Column(String(30))
    selected_supplier = Column(String(255))
    selected_quote_json = Column(JSON)
    remarks = Column(Text)
    attachments_json = Column(JSON)
    source_json = Column(JSON)
    row_version = Column(Integer, default=1)
    updated_by = Column(String(36), ForeignKey("users.id"))
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class Notification(Base):
    __tablename__ = "notifications"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(60), nullable=False)
    title = Column(String(180), nullable=False)
    message = Column(Text)
    task_id = Column(String(36), ForeignKey("rfq_tasks.id", ondelete="CASCADE"))
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    read_at = Column(DateTime(3))

class TaskComment(Base):
    __tablename__ = "task_comments"
    id = Column(String(36), primary_key=True, default=uid)
    task_id = Column(String(36), ForeignKey("rfq_tasks.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)

class QuoteSet(Base):
    __tablename__ = "quote_sets"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    project_id = Column(String(36))
    options_json = Column(JSON)
    field_labels_json = Column(JSON)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class QuoteItem(Base):
    __tablename__ = "quote_items"
    id = Column(String(36), primary_key=True, default=uid)
    quote_set_id = Column(String(36), ForeignKey("quote_sets.id", ondelete="CASCADE"), nullable=False)
    item_index = Column(Integer, nullable=False)
    supplier_name = Column(String(255))
    model = Column(String(200))
    reference = Column(String(200))
    description = Column(Text)
    price = Column(DECIMAL(18,4))
    total_price = Column(DECIMAL(18,4))
    total_rmb = Column(DECIMAL(18,4))
    notes = Column(Text)
    after_sales = Column(Text)
    data_json = Column(JSON)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)

class DataEntry(Base):
    __tablename__ = "data_entries"
    id = Column(String(36), primary_key=True, default=uid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(100), nullable=False)
    data = Column(JSON, nullable=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

class DataDraft(Base):
    __tablename__ = "data_entry_drafts"
    id = Column(String(120), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    template_id = Column(String(80), nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime(3), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(3), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
