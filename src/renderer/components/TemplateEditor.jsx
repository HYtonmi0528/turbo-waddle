import React, { useState, useCallback } from 'react';
import { TEMPLATE_TYPES } from '../utils/constants';

export default function TemplateEditor({ templates, showToast, onRefresh }) {
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [structure, setStructure] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [editColumn, setEditColumn] = useState(null);
  const [columnForm, setColumnForm] = useState({ header: '', width: 15 });
  const [templateForm, setTemplateForm] = useState({ name: '', type: '通用', description: '' });

  const loadStructure = useCallback(async (templateId) => {
    setIsLoading(true);
    try {
      const [data, preview] = await Promise.all([
        window.electronAPI.templates.getStructure(templateId),
        window.electronAPI.templates.getPreview(templateId)
      ]);
      setStructure(data ? { ...data, previewData: preview } : null);
    } catch (e) {
      showToast('加载模板结构失败: ' + e.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const handleSelectTemplate = (tpl) => {
    setSelectedTemplate(tpl);
    setTemplateForm({
      name: tpl.name || '',
      type: tpl.type || '通用',
      description: tpl.description || ''
    });
    loadStructure(tpl.id);
  };

  const handleAddColumn = () => {
    if (!columnForm.header.trim()) {
      showToast('请输入字段名', 'warning');
      return;
    }
    setStructure(prev => ({
      ...prev,
      columns: [
        ...prev.columns,
        {
          colNumber: prev.columns.length + 1,
          sourceColNumber: null,
          header: columnForm.header.trim(),
          width: parseFloat(columnForm.width) || 15,
          style: {
            font: { name: '微软雅黑', size: 11, bold: true },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } },
            alignment: { horizontal: 'center', vertical: 'middle' }
          }
        }
      ]
    }));
    setColumnForm({ header: '', width: 15 });
    showToast('字段已添加（需保存）');
  };

  const handleRemoveColumn = (colIndex) => {
    setStructure(prev => ({
      ...prev,
      columns: prev.columns.filter((_, i) => i !== colIndex).map((col, i) => ({
        ...col,
        colNumber: i + 1
      }))
    }));
  };

  const handleMoveColumn = (colIndex, direction) => {
    const newIndex = colIndex + direction;
    if (newIndex < 0 || newIndex >= structure.columns.length) return;

    setStructure(prev => {
      const cols = [...prev.columns];
      [cols[colIndex], cols[newIndex]] = [cols[newIndex], cols[colIndex]];
      return {
        ...prev,
        columns: cols.map((col, i) => ({ ...col, colNumber: i + 1 }))
      };
    });
  };

  const handleSave = async () => {
    if (!selectedTemplate) return;
    if (!templateForm.name.trim()) {
      showToast('请输入模板名称', 'warning');
      return;
    }
    try {
      const updatedTemplate = await window.electronAPI.templates.updateInfo(selectedTemplate.id, templateForm);
      await window.electronAPI.templates.updateStructure(selectedTemplate.id, structure);
      await loadStructure(selectedTemplate.id);
      setSelectedTemplate(updatedTemplate);
      showToast('模板信息和结构已保存');
      onRefresh();
    } catch (e) {
      showToast('保存失败: ' + e.message, 'error');
    }
  };

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">模板编辑器</h2>
          {selectedTemplate && (
            <span className="badge badge-primary">
              当前模板: {selectedTemplate.name}
            </span>
          )}
        </div>

        {/* 模板选择 */}
        {templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-text">暂无模板可供编辑</div>
            <div className="empty-state-desc">请先在「模板管理」中创建或导入模板</div>
          </div>
        ) : (
          <div className="template-grid mb-12">
            {templates.map(tpl => (
              <div
                key={tpl.id}
                className={`template-card ${selectedTemplate?.id === tpl.id ? 'selected' : ''}`}
                onClick={() => handleSelectTemplate(tpl)}
              >
                <div className="template-card-header">
                  <div className="template-card-icon">📝</div>
                  <div>
                    <div className="template-card-name">{tpl.name}</div>
                  </div>
                </div>
                <span className="template-card-type">{tpl.type}</span>
              </div>
            ))}
          </div>
        )}

        {isLoading && <div className="empty-state"><div className="empty-state-text">加载中...</div></div>}

        {structure && !isLoading && (
          <>
            <div className="card" style={{ background: '#F8F9FC' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>模板基本信息</h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">模板名称</label>
                  <input
                    className="form-input"
                    value={templateForm.name}
                    onChange={event => setTemplateForm({ ...templateForm, name: event.target.value })}
                    placeholder="输入模板名称"
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">模板类型</label>
                  <select
                    className="form-select"
                    value={templateForm.type}
                    onChange={event => setTemplateForm({ ...templateForm, type: event.target.value })}
                  >
                    {TEMPLATE_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                    {!TEMPLATE_TYPES.some(type => type.value === templateForm.type) && (
                      <option value={templateForm.type}>{templateForm.type}</option>
                    )}
                  </select>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">模板说明</label>
                <textarea
                  className="form-input"
                  value={templateForm.description}
                  onChange={event => setTemplateForm({ ...templateForm, description: event.target.value })}
                  placeholder="说明模板用途、适用范围等"
                  rows={2}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>

            {/* 添加字段 */}
            <div className="card" style={{ background: '#F8F9FC' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>添加新字段</h3>
              <div className="flex-between">
                <div className="flex-center gap-8" style={{ flex: 1 }}>
                  <div className="form-group" style={{ flex: 2, marginBottom: 0 }}>
                    <label className="form-label">字段名称</label>
                    <input
                      className="form-input"
                      value={columnForm.header}
                      onChange={e => setColumnForm({ ...columnForm, header: e.target.value })}
                      placeholder="例如：供应商名称"
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">列宽</label>
                    <input
                      className="form-input"
                      type="number"
                      value={columnForm.width}
                      onChange={e => setColumnForm({ ...columnForm, width: e.target.value })}
                      min="5"
                      max="50"
                    />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleAddColumn} style={{ alignSelf: 'flex-end' }}>
                  + 添加
                </button>
              </div>
            </div>

            {/* 字段列表 */}
            <div className="card">
              <div className="card-header">
                <h3 style={{ fontSize: '14px', fontWeight: 600 }}>
                  字段列表 ({structure.columns.length} 个字段)
                </h3>
                <button className="btn btn-success" onClick={handleSave}>保存修改</button>
              </div>

              <div className="table-container" style={{ maxHeight: '350px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>序号</th>
                      <th>字段名</th>
                      <th style={{ width: '100px' }}>列宽</th>
                      <th style={{ width: '200px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {structure.columns.map((col, index) => (
                      <tr key={index}>
                        <td className="row-number">{col.colNumber}</td>
                        <td>
                          {editColumn === index ? (
                            <input
                              className="form-input"
                              value={col.header}
                              onChange={e => {
                                const cols = [...structure.columns];
                                cols[index] = { ...cols[index], header: e.target.value };
                                setStructure({ ...structure, columns: cols });
                              }}
                              onBlur={() => setEditColumn(null)}
                              autoFocus
                            />
                          ) : (
                            <span
                              style={{ cursor: 'pointer', fontWeight: 500 }}
                              onClick={() => setEditColumn(index)}
                            >
                              {col.header}
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            style={{ width: '70px', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: '4px' }}
                            value={col.width}
                            onChange={e => {
                              const cols = [...structure.columns];
                              cols[index] = { ...cols[index], width: parseFloat(e.target.value) || 10 };
                              setStructure({ ...structure, columns: cols });
                            }}
                            min="5"
                          />
                        </td>
                        <td>
                          <div className="flex-center gap-8">
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleMoveColumn(index, -1)}
                              disabled={index === 0}
                            >
                              ↑ 上移
                            </button>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleMoveColumn(index, 1)}
                              disabled={index === structure.columns.length - 1}
                            >
                              ↓ 下移
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleRemoveColumn(index)}
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 模板预览 */}
            {structure?.previewData && (
              <div className="card">
                <div className="card-header">
                  <h3 style={{ fontSize: '14px', fontWeight: 600 }}>模板预览</h3>
                  <span className="text-sm text-muted">
                    {structure.previewData.sheets?.[0]?.name || 'Sheet1'}
                  </span>
                </div>
                <div className="template-preview-mini" style={{ maxHeight: '300px', overflow: 'auto' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {structure.columns.map((col, i) => (
                          <th key={i} style={{
                            backgroundColor: col.style?.fill?.fgColor ? '#' + col.style.fill.fgColor.argb.slice(2) : '#E8EDF5',
                            color: col.style?.font?.color ? '#' + col.style.font.color.argb.slice(2) : '#333'
                          }}>
                            {col.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ textAlign: 'center', color: '#999' }}>1</td>
                        {structure.columns.map((col, i) => (
                          <td key={i} style={{
                            textAlign: col.style?.alignment?.horizontal || 'center',
                            minWidth: col.width * 8
                          }}>
                            {'{{' + col.header + '}}'}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
