const FIELD_ALIASES = {
  supplierName: ['供应商名称', '公司名称', '供应商', '厂家', '厂商', '供货商', 'supplier', 'vendor'],
  productName: ['产品名称', '品名', '商品名称', '物料名称', 'product'],
  model: ['型号', '规格', '型号规格', 'model', 'reference'],
  price: ['含税含运', '含税价', '销售价', '报价', '单价', '价格'],
  cost: ['出厂价', '成本价', '采购价', '进货价', '成本'],
  totalPrice: ['总价', '人民币总价', 'totalprice'],
  usdPrice: ['美元单价', '美金单价', 'usdprice'],
  usdTotalPrice: ['美元总价', '美金总价', 'usdtotalprice'],
  usdCost: ['美金成本', '美元成本', 'usdcost'],
  quantity: ['数量', '采购数量', 'quantity'],
  deliveryTime: ['交货期', '交期', '发货时间', 'deliverytime'],
  paymentTerms: ['付款方式', '付款条件', '账期', 'paymentterms'],
  afterSales: ['售后政策', '售后', '质保政策', 'aftersales'],
  warranty: ['保修期', '质保期', 'warranty'],
  attachment: ['附件', 'pdf', '文档', '文件', '证书', '营业执照', '资质文件'],
  image: ['图片', '照片', '图像', '产品图', '厂房图', 'image', 'photo'],
  notes: ['备注', '说明', 'remark', 'remarks', 'notes']
};

function normalizeFieldName(value) {
  return String(value || '')
    .replace(/\{\{|\}\}/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s/\\()（）【】\[\]：:、,，._-]/g, '');
}

function getMappingTemplateField(mapping) {
  return String(mapping?.templateField ?? mapping?.template_field ?? '').replace(/\{\{|\}\}/g, '').trim();
}

function getMappingSystemField(mapping) {
  return String(mapping?.systemField ?? mapping?.system_field ?? '').trim();
}

function inferSystemFieldKey(value, systemFields = [], options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = normalizeFieldName(raw);
  const availableFields = Array.isArray(systemFields) ? systemFields : [];

  const exactKey = availableFields.find(field => String(field?.key || field?.fieldKey || field?.field_key || '') === raw);
  if (exactKey) return exactKey.key || exactKey.fieldKey || exactKey.field_key;

  const exactLabel = availableFields.find(field => normalizeFieldName(field?.label) === normalized);
  if (exactLabel) return exactLabel.key || exactLabel.fieldKey || exactLabel.field_key;

  const aliasEntry = Object.entries(FIELD_ALIASES).find(([key, aliases]) =>
    normalizeFieldName(key) === normalized || aliases.some(alias => normalizeFieldName(alias) === normalized)
  );
  if (aliasEntry) return aliasEntry[0];

  const partialAliasEntry = Object.entries(FIELD_ALIASES).find(([, aliases]) =>
    aliases.some(alias => {
      const normalizedAlias = normalizeFieldName(alias);
      return normalizedAlias.length >= 2 && (normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized));
    })
  );
  if (partialAliasEntry) return partialAliasEntry[0];

  return options.allowUnknown === false ? '' : raw;
}

function normalizePersistedMapping(mapping, systemFields = []) {
  const templateField = getMappingTemplateField(mapping);
  const configuredSystemField = getMappingSystemField(mapping);
  return {
    templateField,
    systemField: inferSystemFieldKey(configuredSystemField || templateField, systemFields, {
      allowUnknown: Boolean(configuredSystemField)
    })
  };
}

module.exports = {
  FIELD_ALIASES,
  normalizeFieldName,
  getMappingTemplateField,
  getMappingSystemField,
  inferSystemFieldKey,
  normalizePersistedMapping
};
