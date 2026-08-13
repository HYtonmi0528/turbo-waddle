import React, { useState, useEffect, useCallback } from 'react';

const FIELD_ALIASES = {
  supplierName: ['公司名称', '供应商', '厂家', '厂商', '供货商'],
  productName: ['产品名称', '品名', '商品名称', '物料名称'],
  model: ['型号', '规格', '型号规格'],
  price: ['含税含运', '含税价', '销售价', '报价', '单价', '价格'],
  cost: ['出厂价', '成本价', '采购价', '进货价'],
  usdCost: ['美金成本', '美元成本', 'USD成本'],
  afterSales: ['售后政策', '售后', '质保政策'],
  warranty: ['保修期', '质保期'],
  deliveryTime: ['交货期', '交期', '发货时间'],
  paymentTerms: ['付款方式', '付款条件', '账期'],
  quantity: ['数量', '采购数量'],
  attachment: ['附件', 'PDF', '文档', '证书', '营业执照', '资质文件'],
  image: ['图片', '照片', '图像', '产品图', '厂房图'],
  notes: ['备注', '说明']
};

const normalizeFieldName = value => (value || '')
  .toLowerCase()
  .replace(/[\s/\\()（）【】\[\]：:、,_-]/g, '');

const systemFieldKey = field => field?.key || field?.fieldKey || field?.field_key || '';

const inferCustomFieldType = label => {
  const normalized = normalizeFieldName(label);
  if (/(图片|照片|图像|产品图|厂房图|image|photo)/i.test(normalized)) return 'image';
  if (/(附件|pdf|文档|文件|证书|执照|资质)/i.test(normalized)) return 'file';
  return 'text';
};

const DATA_TYPE_LABELS = {
  text: '文本',
  number: '数字',
  file: '附件',
  image: '图片'
};

export default function FieldMapping({ templates, selectedTemplate: initialTemplate, showToast }) {
  const [selectedTemplate, setSelectedTemplate] = useState(initialTemplate);
  const [templateFields, setTemplateFields] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [systemFields, setSystemFields] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [customFieldForm, setCustomFieldForm] = useState({ label: '', dataType: 'text' });
  const [isAddingField, setIsAddingField] = useState(false);
  const [inlineAddingField, setInlineAddingField] = useState('');
  const [addingTemplateFieldKey, setAddingTemplateFieldKey] = useState('');

  const loadSystemFields = useCallback(async () => {
    try {
      const fields = await window.electronAPI.fieldMapping.getSystemFields();
      setSystemFields(fields || []);
    } catch (error) {
      showToast('加载系统字段失败: ' + error.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    loadSystemFields();
  }, [loadSystemFields]);

  const loadMappings = useCallback(async (tpl) => {
    if (!tpl) return;
    try {
      // 获取已有映射
      const existingMappings = await window.electronAPI.fieldMapping.get(tpl.id);

      // 尝试获取模板结构中的字段
      let fields = [];
      try {
        const structure = await window.electronAPI.templates.getStructure(tpl.id);
        fields = structure?.columns?.map(col => (col.header || col.name || col.label || '').replace(/\{\{|\}\}/g, '').trim()).filter(Boolean) || [];
      } catch (e) {
        // 如果获取结构失败，尝试从历史导入数据中获取
      }

      // 如果没有提取到字段，使用一些默认字段
      if (fields.length === 0) {
        fields = ['公司名称', '产品名称', '型号', '价格', '数量', '备注'];
      }

      setTemplateFields(fields);

      // 构建映射表
      const mappingList = fields.map(field => {
        const existing = existingMappings.find(m => normalizeFieldName(m.template_field || m.templateField) === normalizeFieldName(field));
        return {
          templateField: field,
          systemField: existing ? (existing.system_field || existing.systemField || '') : ''
        };
      });

      setMappings(mappingList);
    } catch (e) {
      showToast('加载字段失败: ' + e.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    if (selectedTemplate) {
      loadMappings(selectedTemplate);
    }
  }, [selectedTemplate, loadMappings]);

  useEffect(() => {
    if (initialTemplate) {
      setSelectedTemplate(initialTemplate);
    }
  }, [initialTemplate]);

  const handleMappingChange = (templateField, systemField) => {
    setMappings(prev =>
      prev.map(m =>
        m.templateField === templateField ? { ...m, systemField } : m
      )
    );
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    setIsSaving(true);
    try {
      const validMappings = mappings.filter(m => m.systemField);
      await window.electronAPI.fieldMapping.save(selectedTemplate.id, validMappings);
      showToast('字段映射已保存');
    } catch (e) {
      showToast('保存失败: ' + e.message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoMap = () => {
    const autoMapped = mappings.map(m => {
      if (m.systemField && systemFields.some(field => systemFieldKey(field) === m.systemField)) return m;

      const normalizedField = normalizeFieldName(m.templateField);
      const aliasMatch = systemFields.find(sf =>
        (FIELD_ALIASES[systemFieldKey(sf)] || []).some(alias =>
          normalizedField.includes(normalizeFieldName(alias))
        )
      );
      const matched = aliasMatch || systemFields.find(sf => {
        const normalizedLabel = normalizeFieldName(sf.label);
        const normalizedKey = normalizeFieldName(systemFieldKey(sf));
        return normalizedLabel.includes(normalizedField) || normalizedField.includes(normalizedLabel) ||
          normalizedKey.includes(normalizedField) || normalizedField.includes(normalizedKey);
      });

      return {
        ...m,
        systemField: matched ? systemFieldKey(matched) : m.systemField
      };
    });

    setMappings(autoMapped);
    showToast('自动映射完成，请检查结果');
  };

  const handleAddFieldToCurrentTemplate = async (field) => {
    if (!selectedTemplate) {
      showToast('请先选择要添加字段的模板', 'warning');
      return;
    }

    const existingTemplateField = templateFields.find(templateField =>
      normalizeFieldName(templateField) === normalizeFieldName(field.label)
    );
    if (existingTemplateField) {
      handleMappingChange(existingTemplateField, systemFieldKey(field));
      showToast(`“${field.label}”已在当前模板中，请点击“保存映射”`);
      return;
    }

    setAddingTemplateFieldKey(systemFieldKey(field));
    try {
      const [structure, persistedMappings] = await Promise.all([
        window.electronAPI.templates.getStructure(selectedTemplate.id),
        window.electronAPI.fieldMapping.get(selectedTemplate.id)
      ]);
      if (!structure || !Array.isArray(structure.columns)) {
        throw new Error('无法读取当前模板结构');
      }

      const existingColumn = structure.columns.find(column =>
        normalizeFieldName(column.header) === normalizeFieldName(field.label)
      );
      const templateFieldName = existingColumn?.header || field.label;
      if (!existingColumn) {
        const referenceStyle = structure.columns[structure.columns.length - 1]?.style;
        const newColumn = {
          colNumber: structure.columns.length + 1,
          sourceColNumber: null,
          header: field.label,
          width: field.dataType === 'image' ? 24 : field.dataType === 'file' ? 22 : 15,
          style: referenceStyle || {
            font: { name: '微软雅黑', size: 11, bold: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } },
            alignment: { horizontal: 'center', vertical: 'middle' }
          }
        };

        await window.electronAPI.templates.updateStructure(selectedTemplate.id, {
          ...structure,
          columns: [...structure.columns, newColumn]
        });
      }

      const nextMappings = (persistedMappings || [])
        .filter(mapping =>
          normalizeFieldName(mapping.template_field || mapping.templateField) !== normalizeFieldName(templateFieldName)
        )
        .map(mapping => ({
          templateField: mapping.template_field || mapping.templateField,
          systemField: mapping.system_field || mapping.systemField
        }));
      nextMappings.push({
        templateField: templateFieldName,
        systemField: systemFieldKey(field)
      });
      await window.electronAPI.fieldMapping.save(selectedTemplate.id, nextMappings);
      await loadMappings(selectedTemplate);
      showToast(`“${field.label}”已加入模板并完成映射`);
    } catch (error) {
      showToast('加入当前模板失败: ' + error.message, 'error');
    } finally {
      setAddingTemplateFieldKey('');
    }
  };

  const handleAddSystemField = async () => {
    if (!customFieldForm.label.trim()) {
      showToast('请输入自定义系统字段名称', 'warning');
      return;
    }
    setIsAddingField(true);
    try {
      const created = await window.electronAPI.fieldMapping.addSystemField({
        label: customFieldForm.label.trim(),
        dataType: customFieldForm.dataType
      });
      await loadSystemFields();
      setCustomFieldForm({ label: '', dataType: 'text' });
      if (selectedTemplate) {
        await handleAddFieldToCurrentTemplate(created);
      } else {
        showToast(`自定义系统字段“${created.label}”已添加`);
      }
    } catch (error) {
      showToast('添加失败: ' + error.message, 'error');
    } finally {
      setIsAddingField(false);
    }
  };

  const handleCreateAndMap = async (mapping) => {
      const sameNameField = systemFields.find(field =>
      normalizeFieldName(field.label) === normalizeFieldName(mapping.templateField)
    );
    if (sameNameField) {
      handleMappingChange(mapping.templateField, systemFieldKey(sameNameField));
      showToast(`已选择系统字段“${sameNameField.label}”，请保存映射`);
      return;
    }

    setInlineAddingField(mapping.templateField);
    try {
      const created = await window.electronAPI.fieldMapping.addSystemField({
        label: mapping.templateField,
        dataType: inferCustomFieldType(mapping.templateField)
      });
      setSystemFields(prev => [...prev, created]);
      handleMappingChange(mapping.templateField, systemFieldKey(created));
      showToast(`已创建并选择“${created.label}”，请点击保存映射`);
    } catch (error) {
      showToast('创建自定义映射失败: ' + error.message, 'error');
      await loadSystemFields();
    } finally {
      setInlineAddingField('');
    }
  };

  const handleDeleteSystemField = async (field) => {
    if (mappings.some(mapping => mapping.systemField === systemFieldKey(field))) {
      showToast('当前映射正在使用该字段，请先改选其他字段并保存映射', 'warning');
      return;
    }
    if (!confirm(`确定删除自定义系统字段“${field.label}”吗？`)) return;
    try {
      await window.electronAPI.fieldMapping.deleteSystemField(systemFieldKey(field));
      await loadSystemFields();
      showToast(`自定义系统字段“${field.label}”已删除`);
    } catch (error) {
      showToast('删除失败: ' + error.message, 'error');
    }
  };

  const mappedCount = mappings.filter(m => m.systemField).length;

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">字段映射配置</h2>
          <div className="flex-center gap-8">
            <span className="badge badge-success">{mappedCount}/{mappings.length} 已映射</span>
            <button className="btn btn-outline btn-sm" onClick={handleAutoMap}>自动映射</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '保存映射'}
            </button>
          </div>
        </div>

        <p className="text-sm text-muted mb-12">
          将模板中的字段名称映射到系统统一数据字段。不同模板中不同名称的相同含义字段（如「公司名称」「供应商」「厂家」）可映射到同一个系统字段。
        </p>

        <div className="card" style={{ background: '#F8F9FC', padding: '18px', marginBottom: '16px' }}>
          <div className="flex-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ fontSize: '14px', marginBottom: '4px' }}>自定义系统字段</h3>
              <div className="text-sm text-muted">
                添加后可供所有模板映射和数据录入使用；未映射的字段也可以在下方直接点击“同名新增”。
              </div>
            </div>
            <div className="flex-center gap-8" style={{ flex: 1, justifyContent: 'flex-end', minWidth: '420px' }}>
              <input
                className="form-input"
                value={customFieldForm.label}
                onChange={event => setCustomFieldForm({ ...customFieldForm, label: event.target.value })}
                onKeyDown={event => event.key === 'Enter' && handleAddSystemField()}
                placeholder="例如：品牌、颜色、包装尺寸"
                style={{ maxWidth: '240px' }}
              />
              <select
                className="form-select"
                value={customFieldForm.dataType}
                onChange={event => setCustomFieldForm({ ...customFieldForm, dataType: event.target.value })}
                style={{ width: '110px' }}
              >
                <option value="text">文本</option>
                <option value="number">数字</option>
                <option value="file">附件</option>
                <option value="image">图片</option>
              </select>
              <button
                className="btn btn-success"
                onClick={handleAddSystemField}
                disabled={isAddingField}
              >
                {isAddingField ? '添加中...' : '+ 添加字段'}
              </button>
            </div>
          </div>

          {systemFields.some(field => field.isCustom) && (
            <div className="flex-center gap-8" style={{ flexWrap: 'wrap', marginTop: '14px' }}>
              {systemFields.filter(field => field.isCustom).map(field => (
                <span
                  key={systemFieldKey(field)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 9px',
                    background: '#E8EDF5',
                    borderRadius: '5px',
                    fontSize: '12px'
                  }}
                >
                  {field.label}
                  <span className="text-muted">({DATA_TYPE_LABELS[field.dataType] || '文本'})</span>
                  {selectedTemplate && !templateFields.some(templateField =>
                    normalizeFieldName(templateField) === normalizeFieldName(field.label)
                  ) && (
                    <button
                      onClick={() => handleAddFieldToCurrentTemplate(field)}
                      disabled={Boolean(addingTemplateFieldKey)}
                      title={`将“${field.label}”添加为当前模板的新表头并自动映射`}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: 'var(--primary)',
                        cursor: addingTemplateFieldKey ? 'wait' : 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      {addingTemplateFieldKey === systemFieldKey(field) ? '添加中...' : '+ 加入当前模板'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteSystemField(field)}
                    title="删除自定义字段"
                    style={{ border: 0, background: 'transparent', color: '#C0392B', cursor: 'pointer', fontSize: '14px' }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 模板选择 */}
        {templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-text">暂无模板</div>
          </div>
        ) : (
          <div className="template-grid mb-12">
            {templates.map(tpl => (
              <div
                key={tpl.id}
                className={`template-card ${selectedTemplate?.id === tpl.id ? 'selected' : ''}`}
                onClick={() => setSelectedTemplate(tpl)}
              >
                <div className="template-card-header">
                  <div className="template-card-icon">🔗</div>
                  <div>
                    <div className="template-card-name">{tpl.name}</div>
                  </div>
                </div>
                <span className="template-card-type">{tpl.type}</span>
              </div>
            ))}
          </div>
        )}

        {!selectedTemplate && (
          <div className="empty-state">
            <div className="empty-state-icon">👆</div>
            <div className="empty-state-text">请选择一个模板</div>
            <div className="empty-state-desc">选择模板后即可配置字段映射关系</div>
          </div>
        )}

        {selectedTemplate && templateFields.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">⚠️</div>
            <div className="empty-state-text">未能提取到模板字段</div>
            <div className="empty-state-desc">
              请确保模板中使用 {'{{字段名}}'} 格式标记了占位符，或在模板编辑器中添加字段
            </div>
          </div>
        )}

        {selectedTemplate && templateFields.length > 0 && (
          <div className="table-container" style={{ maxHeight: '450px' }}>
            <table className="mapping-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>模板字段</th>
                  <th style={{ width: '10%' }}></th>
                  <th style={{ width: '50%' }}>系统字段</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping, index) => (
                  <tr key={index}>
                    <td>
                      <span style={{
                        background: '#E8EDF5',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        fontSize: '13px',
                        fontWeight: 500
                      }}>
                        {mapping.templateField}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', fontSize: '18px', color: 'var(--primary)' }}>
                      →
                    </td>
                    <td>
                      <div className="mapping-control">
                        <select
                          className="form-select"
                          value={mapping.systemField}
                          onChange={e => handleMappingChange(mapping.templateField, e.target.value)}
                          style={{
                            borderColor: mapping.systemField ? 'var(--success)' : 'var(--warning)'
                          }}
                        >
                          <option value="">-- 请选择系统字段 --</option>
                          {/* 按类别分组 */}
                          {(() => {
                            const categories = {};
                            systemFields.forEach(sf => {
                              const cat = sf.category || '其他';
                              if (!categories[cat]) categories[cat] = [];
                              categories[cat].push(sf);
                            });
                            return Object.entries(categories).map(([cat, fields]) => (
                              <optgroup key={cat} label={cat}>
                                {fields.map(sf => (
                                  <option key={systemFieldKey(sf)} value={systemFieldKey(sf)}>
                                    {sf.label}
                                  </option>
                                ))}
                              </optgroup>
                            ));
                          })()}
                        </select>
                        {!mapping.systemField && (
                          <button
                            className="btn btn-outline btn-sm mapping-create-btn"
                            onClick={() => handleCreateAndMap(mapping)}
                            disabled={Boolean(inlineAddingField)}
                            title={`创建自定义系统字段“${mapping.templateField}”并立即选中`}
                          >
                            {inlineAddingField === mapping.templateField ? '创建中…' : '+ 同名新增'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
