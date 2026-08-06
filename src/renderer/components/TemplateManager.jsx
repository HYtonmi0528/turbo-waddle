import React, { useState } from 'react';
import { TEMPLATE_TYPES } from '../utils/constants';

const EMPTY_TEMPLATE = { name: '', type: '通用', description: '', fields: '' };

function parseFieldNames(value) {
  return [...new Set(
    value
      .split(/[\n,，;；\t]+/)
      .map(field => field.trim().replace(/^\{\{|\}\}$/g, '').trim())
      .filter(Boolean)
  )];
}

export default function TemplateManager({ templates, onRefresh, onSelect, onMappingClick, showToast }) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTemplate, setNewTemplate] = useState(EMPTY_TEMPLATE);
  const [filterType, setFilterType] = useState('all');
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const filteredTemplates = filterType === 'all'
    ? templates
    : templates.filter(t => t.type === filterType);

  const handleCreate = async () => {
    if (!newTemplate.name.trim()) {
      showToast('请输入模板名称', 'warning');
      return;
    }

    const fields = parseFieldNames(newTemplate.fields);
    if (fields.length > 256) {
      showToast('字段数量不能超过 256 个', 'warning');
      return;
    }

    setIsCreating(true);
    try {
      await window.electronAPI.templates.save({
        name: newTemplate.name.trim(),
        type: newTemplate.type,
        description: newTemplate.description.trim(),
        fields,
        isBuiltin: false
      });
      
      setShowNewModal(false);
      setNewTemplate(EMPTY_TEMPLATE);
      showToast(fields.length > 0 ? `模板已按 ${fields.length} 个字段生成` : '模板已按默认字段生成');
      await onRefresh();
    } catch (e) {
      showToast('创建失败: ' + e.message, 'error');
    } finally {
      setIsCreating(false);
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.templates.import();
      if (result) {
        showToast(`模板 "${result.name}" 导入成功`);
        onRefresh();
      }
    } catch (e) {
      showToast('导入失败: ' + e.message, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDelete = async (template) => {
    if (!confirm(`确定要删除模板 "${template.name}" 吗？此操作不可撤销。`)) return;

    try {
      await window.electronAPI.templates.delete(template.id);
      showToast('模板已删除');
      onRefresh();
    } catch (e) {
      showToast('删除失败: ' + e.message, 'error');
    }
  };

  const handleDuplicate = async (template) => {
    try {
      await window.electronAPI.templates.duplicate(template.id);
      showToast('模板已复制');
      onRefresh();
    } catch (e) {
      showToast('复制失败: ' + e.message, 'error');
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">模板管理</h2>
          <div className="flex-center gap-8">
            <button className="btn btn-primary" onClick={() => setShowNewModal(true)}>
              + 新建模板
            </button>
            <button className="btn btn-outline" onClick={handleImport} disabled={isImporting}>
              {isImporting ? '导入中...' : '📥 导入Excel模板'}
            </button>
          </div>
        </div>

        {/* 类型筛选 */}
        <div className="template-type-bar flex-center gap-8">
          <button
            className={`btn btn-sm ${filterType === 'all' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setFilterType('all')}
          >
            全部
          </button>
          {TEMPLATE_TYPES.map(tp => (
            <button
              key={tp.value}
              className={`btn btn-sm ${filterType === tp.value ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilterType(tp.value)}
            >
              {tp.icon} {tp.label}
            </button>
          ))}
        </div>

        {filteredTemplates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-text">暂无模板</div>
            <div className="empty-state-desc">
              点击「新建模板」创建空白模板，或「导入Excel模板」从现有Excel文件导入
            </div>
          </div>
        ) : (
          <div className="template-grid">
            {filteredTemplates.map(tpl => (
              <div key={tpl.id} className="template-card">
                <div className="template-card-header">
                  <div className="template-card-icon">
                    {tpl.type === '询价表' ? '📋' :
                     tpl.type === '报价表' ? '💰' :
                     tpl.type === '供应商对比表' ? '📊' :
                     tpl.type === '客户报价单' ? '📝' : '📄'}
                  </div>
                  <div>
                    <div className="template-card-name">{tpl.name}</div>
                    <div className="text-sm text-muted">{new Date(tpl.updated_at).toLocaleDateString('zh-CN')}</div>
                  </div>
                </div>
                <span className="template-card-type">{tpl.type}</span>
                {tpl.description && (
                  <div className="template-card-desc">{tpl.description}</div>
                )}
                {tpl.is_builtin ? (
                  <span className="badge badge-primary">内置</span>
                ) : null}
                <div className="template-card-actions mt-12">
                  <button className="btn btn-primary btn-sm" onClick={() => onSelect(tpl)}>
                    使用
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => onMappingClick(tpl)}>
                    字段映射
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => handleDuplicate(tpl)}>
                    复制
                  </button>
                  {!tpl.is_builtin && (
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(tpl)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建模板弹窗 */}
      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">输入字段生成模板</h3>
            
            <div className="form-group">
              <label className="form-label">模板名称 *</label>
              <input
                className="form-input"
                value={newTemplate.name}
                onChange={e => setNewTemplate({ ...newTemplate, name: e.target.value })}
                placeholder="例如：2024年度供应商询价表"
              />
            </div>

            <div className="form-group">
              <label className="form-label">模板类型</label>
              <select
                className="form-select"
                value={newTemplate.type}
                onChange={e => setNewTemplate({ ...newTemplate, type: e.target.value })}
              >
                {TEMPLATE_TYPES.map(tp => (
                  <option key={tp.value} value={tp.value}>{tp.icon} {tp.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">模板字段</label>
              <textarea
                className="form-textarea"
                value={newTemplate.fields}
                onChange={e => setNewTemplate({ ...newTemplate, fields: e.target.value })}
                placeholder={'每行输入一个字段，也可以用逗号分隔\n例如：公司名称、型号、价格、售后政策、备注'}
                rows={6}
              />
              <div className="text-sm text-muted" style={{ marginTop: 6 }}>
                已输入 {parseFieldNames(newTemplate.fields).length} 个字段；留空则按所选模板类型生成默认字段。
              </div>
              {parseFieldNames(newTemplate.fields).length > 0 && (
                <div className="flex-center gap-8" style={{ flexWrap: 'wrap', marginTop: 10 }}>
                  {parseFieldNames(newTemplate.fields).slice(0, 20).map(field => (
                    <span key={field} className="badge badge-primary">{field}</span>
                  ))}
                  {parseFieldNames(newTemplate.fields).length > 20 && (
                    <span className="text-sm text-muted">还有 {parseFieldNames(newTemplate.fields).length - 20} 个…</span>
                  )}
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">描述</label>
              <textarea
                className="form-textarea"
                value={newTemplate.description}
                onChange={e => setNewTemplate({ ...newTemplate, description: e.target.value })}
                placeholder="简要描述模板用途..."
                rows={3}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setShowNewModal(false)} disabled={isCreating}>取消</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={isCreating}>
                {isCreating ? '生成中...' : '生成模板'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
