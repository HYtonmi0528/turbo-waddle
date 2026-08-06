const { v4: uuidv4 } = require('uuid');

const BUILTIN_SYSTEM_FIELDS = [
  { key: 'supplierName', label: '供应商名称', category: '供应商信息', dataType: 'text' },
  { key: 'productName', label: '产品名称', category: '产品信息', dataType: 'text' },
  { key: 'model', label: '型号/规格', category: '产品信息', dataType: 'text' },
  { key: 'price', label: '价格/单价', category: '价格信息', dataType: 'number' },
  { key: 'cost', label: '成本', category: '价格信息', dataType: 'number' },
  { key: 'profit', label: '利润', category: '价格信息', dataType: 'number' },
  { key: 'profitRate', label: '利润率', category: '价格信息', dataType: 'number' },
  { key: 'totalPrice', label: '总价', category: '价格信息', dataType: 'number' },
  { key: 'usdPrice', label: '美元单价', category: '价格信息', dataType: 'number' },
  { key: 'usdTotalPrice', label: '美元总价', category: '价格信息', dataType: 'number' },
  { key: 'usdCost', label: '美元成本', category: '价格信息', dataType: 'number' },
  { key: 'quantity', label: '数量', category: '交易信息', dataType: 'number' },
  { key: 'deliveryTime', label: '交货期', category: '交易信息', dataType: 'text' },
  { key: 'paymentTerms', label: '付款方式', category: '交易信息', dataType: 'text' },
  { key: 'afterSales', label: '售后政策', category: '售后信息', dataType: 'text' },
  { key: 'warranty', label: '保修期', category: '售后信息', dataType: 'text' },
  { key: 'quoteNumber', label: '报价编号', category: '编号信息', dataType: 'text' },
  { key: 'date', label: '日期', category: '编号信息', dataType: 'text' },
  { key: 'contactPerson', label: '联系人', category: '联系信息', dataType: 'text' },
  { key: 'contactPhone', label: '联系电话', category: '联系信息', dataType: 'text' },
  { key: 'companyAddress', label: '公司地址', category: '联系信息', dataType: 'text' },
  { key: 'attachment', label: '附件/PDF文档', category: '附件资料', dataType: 'file' },
  { key: 'image', label: '图片/照片', category: '附件资料', dataType: 'image' },
  { key: 'notes', label: '备注', category: '其他', dataType: 'text' }
];

function validateCustomFieldInput(input, existingFields = BUILTIN_SYSTEM_FIELDS) {
  const label = String(input?.label || '').trim();
  const allowedDataTypes = new Set(['text', 'number', 'file', 'image']);
  const dataType = allowedDataTypes.has(input?.dataType) ? input.dataType : 'text';
  if (!label) throw new Error('请输入自定义系统字段名称');
  if (label.length > 50) throw new Error('系统字段名称不能超过 50 个字符');
  const normalized = label.toLowerCase().replace(/\s+/g, '');
  if (existingFields.some(field =>
    String(field.label || '').trim().toLowerCase().replace(/\s+/g, '') === normalized
  )) {
    throw new Error(`系统字段“${label}”已存在`);
  }
  return { label, dataType };
}

function listSystemFields(db) {
  const customFields = db.prepare(`
    SELECT key, label, category, data_type
    FROM custom_system_fields
    ORDER BY created_at ASC
  `).all().map(field => ({
    key: field.key,
    label: field.label,
    category: field.category || '自定义字段',
    dataType: field.data_type || 'text',
    isCustom: true
  }));
  return [
    ...BUILTIN_SYSTEM_FIELDS.map(field => ({ ...field, isCustom: false })),
    ...customFields
  ];
}

function addCustomSystemField(db, input) {
  const fields = listSystemFields(db);
  const validated = validateCustomFieldInput(input, fields);
  const key = `custom_${uuidv4().replace(/-/g, '')}`;
  db.prepare(`
    INSERT INTO custom_system_fields (key, label, category, data_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(key, validated.label, '自定义字段', validated.dataType, new Date().toISOString());
  return {
    key,
    label: validated.label,
    category: '自定义字段',
    dataType: validated.dataType,
    isCustom: true
  };
}

function deleteCustomSystemField(db, key) {
  const field = db.prepare('SELECT * FROM custom_system_fields WHERE key = ?').get(key);
  if (!field) throw new Error('自定义系统字段不存在');
  const usage = db.prepare('SELECT COUNT(*) AS count FROM field_mappings WHERE system_field = ?').get(key);
  if ((usage?.count || 0) > 0) {
    throw new Error(`字段“${field.label}”正在被 ${usage.count} 个模板字段使用，请先取消相关映射`);
  }
  db.prepare('DELETE FROM custom_system_fields WHERE key = ?').run(key);
  return true;
}

module.exports = {
  BUILTIN_SYSTEM_FIELDS,
  validateCustomFieldInput,
  listSystemFields,
  addCustomSystemField,
  deleteCustomSystemField
};
