export const TEMPLATE_TYPES = [
  { value: '询价表', label: '询价表', icon: '📋' },
  { value: '报价表', label: '报价表', icon: '💰' },
  { value: '供应商对比表', label: '供应商对比表', icon: '📊' },
  { value: '客户报价单', label: '客户报价单', icon: '📝' },
  { value: '通用', label: '通用模板', icon: '📄' }
];

export const SYSTEM_FIELDS = [
  { key: 'supplierName', label: '供应商名称', category: '供应商信息' },
  { key: 'productName', label: '产品名称', category: '产品信息' },
  { key: 'model', label: '型号/规格', category: '产品信息' },
  { key: 'price', label: '价格/单价', category: '价格信息' },
  { key: 'cost', label: '成本', category: '价格信息' },
  { key: 'profit', label: '利润', category: '价格信息' },
  { key: 'profitRate', label: '利润率', category: '价格信息' },
  { key: 'totalPrice', label: '总价', category: '价格信息' },
  { key: 'quantity', label: '数量', category: '交易信息' },
  { key: 'deliveryTime', label: '交货期', category: '交易信息' },
  { key: 'paymentTerms', label: '付款方式', category: '交易信息' },
  { key: 'afterSales', label: '售后政策', category: '售后信息' },
  { key: 'warranty', label: '保修期', category: '售后信息' },
  { key: 'quoteNumber', label: '报价编号', category: '编号信息' },
  { key: 'date', label: '日期', category: '编号信息' },
  { key: 'contactPerson', label: '联系人', category: '联系信息' },
  { key: 'contactPhone', label: '联系电话', category: '联系信息' },
  { key: 'companyAddress', label: '公司地址', category: '联系信息' },
  { key: 'attachment', label: '附件/PDF文档', category: '附件资料' },
  { key: 'image', label: '图片/照片', category: '附件资料' },
  { key: 'notes', label: '备注', category: '其他' }
];

export const DEFAULT_DATA_ITEM = {
  supplierName: '',
  productName: '',
  model: '',
  price: '',
  cost: '',
  quantity: '1',
  afterSales: '',
  warranty: '',
  deliveryTime: '',
  paymentTerms: '',
  notes: '',
  contactPerson: '',
  contactPhone: '',
  companyAddress: ''
};
