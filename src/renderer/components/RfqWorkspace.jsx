import React, { useEffect, useMemo, useState } from 'react';
import {
  flattenQuoteSet,
  sortCandidatesForTarget
} from '../utils/rfqMatching';

const numberValue = value => {
  const parsed = Number(String(value ?? '').replace(/[¥￥$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstValue = (object, keys) => {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
};

const isAttachment = value => Boolean(
  value && typeof value === 'object' &&
  (value.kind === 'image' || value.kind === 'file') &&
  (value.path || value.relativePath)
);

const candidateAttachment = candidate => {
  if (candidate && Object.prototype.hasOwnProperty.call(candidate, '_rfqAttachment')) {
    return isAttachment(candidate._rfqAttachment) ? candidate._rfqAttachment : null;
  }
  return Object.values(candidate || {}).find(isAttachment) || null;
};

const calculateCandidateUsd = (candidate, quoteSet, exchangeRate, invoiceType) => {
  const direct = firstValue(candidate, ['usdCost', 'usdPrice', 'unitPriceUsd']);
  if (numberValue(direct)) return numberValue(direct);
  const rmb = firstValue(candidate, ['price', 'totalPrice', 'totalRmb']);
  const rate = numberValue(exchangeRate) || numberValue(quoteSet?.options?.exchangeRate) || 7.25;
  const taxDivisor = invoiceType === 'regular' ? 1 : 1.13;
  return numberValue(rmb) / rate / taxDivisor;
};

function ProjectSummary({ project }) {
  if (!project) return null;
  const metadata = project.metadata || {};
  return (
    <div className="rfq-project-summary">
      <div>
        <span>客户</span>
        <strong>{metadata.customer || '未识别'}</strong>
      </div>
      <div>
        <span>业务员</span>
        <strong>{metadata.salesperson || '未识别'}</strong>
      </div>
      <div>
        <span>产品条目</span>
        <strong>{project.items?.length || project.item_count || 0}</strong>
      </div>
      <div>
        <span>状态</span>
        <strong>
          {project.status === 'generated' ? '已生成' :
            project.status === 'selected' ? '已完成选择' : '待选择'}
        </strong>
      </div>
    </div>
  );
}

export default function RfqWorkspace({ showToast, onContinueInquiry }) {
  const [projects, setProjects] = useState([]);
  const [quoteSets, setQuoteSets] = useState([]);
  const [activeProject, setActiveProject] = useState(null);
  const [selectedQuoteSetId, setSelectedQuoteSetId] = useState('');
  const [selections, setSelections] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('7.25');
  const [invoiceType, setInvoiceType] = useState('special');

  const refreshLists = async (preferredProjectId = null) => {
    setIsLoading(true);
    try {
      const [projectList, quoteSetList] = await Promise.all([
        window.electronAPI.rfq.listProjects(),
        window.electronAPI.rfq.listQuoteSets()
      ]);
      setProjects(projectList || []);
      setQuoteSets(quoteSetList || []);
      if (quoteSetList?.length && !selectedQuoteSetId) {
        setSelectedQuoteSetId(quoteSetList[0].id);
        const options = quoteSetList[0].options || {};
        if (options.exchangeRate) setExchangeRate(String(options.exchangeRate));
        if (options.invoiceType) setInvoiceType(options.invoiceType);
      }
      const nextProjectId = preferredProjectId || activeProject?.id || projectList?.[0]?.id;
      if (nextProjectId) {
        const project = await window.electronAPI.rfq.getProject(nextProjectId);
        setActiveProject(project);
        setSelections(Object.fromEntries(
          (project.selections || []).map(selection => [
            selection.item_id,
            {
              ...selection.selected_data,
              _quoteEntryId: selection.quote_entry_id,
              _quoteItemIndex: selection.quote_item_index
            }
          ])
        ));
      } else {
        setActiveProject(null);
      }
    } catch (error) {
      showToast(`加载询价项目失败：${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshLists();
  }, []);

  const selectedQuoteSet = useMemo(
    () => quoteSets.find(quoteSet => quoteSet.id === selectedQuoteSetId) || null,
    [quoteSets, selectedQuoteSetId]
  );

  const candidates = useMemo(
    () => selectedQuoteSet ? flattenQuoteSet(selectedQuoteSet) : [],
    [selectedQuoteSet]
  );

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const result = await window.electronAPI.rfq.importProject();
      if (result?.canceled) return;
      const project = result.project;
      setActiveProject(project);
      setSelections({});
      await refreshLists(project.id);
      showToast(`已识别 ${project.items.length} 个询价产品，现在可以录入供应商报价`);
      onContinueInquiry?.(project);
    } catch (error) {
      showToast(error.message || '询价单导入失败', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleProjectSelect = async projectId => {
    try {
      const project = await window.electronAPI.rfq.getProject(projectId);
      setActiveProject(project);
      setSelections(Object.fromEntries(
        (project.selections || []).map(selection => [
          selection.item_id,
          {
            ...selection.selected_data,
            _quoteEntryId: selection.quote_entry_id,
            _quoteItemIndex: selection.quote_item_index
          }
        ])
      ));
    } catch (error) {
      showToast(`打开询价项目失败：${error.message}`, 'error');
    }
  };

  const handleQuoteSetChange = quoteSetId => {
    setSelectedQuoteSetId(quoteSetId);
    setSelections({});
    const quoteSet = quoteSets.find(item => item.id === quoteSetId);
    if (quoteSet?.options?.exchangeRate) {
      setExchangeRate(String(quoteSet.options.exchangeRate));
    }
    if (quoteSet?.options?.invoiceType) {
      setInvoiceType(quoteSet.options.invoiceType);
    }
  };

  const toggleCandidate = (itemId, candidate) => {
    setSelections(current => {
      const selected = current[itemId];
      if (
        selected?._quoteEntryId === candidate._quoteEntryId &&
        selected?._quoteItemIndex === candidate._quoteItemIndex
      ) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }
      return { ...current, [itemId]: candidate };
    });
  };

  const updateSelectedField = (itemId, field, value) => {
    setSelections(current => current[itemId]
      ? { ...current, [itemId]: { ...current[itemId], [field]: value } }
      : current);
  };

  const handleSelectRfqAttachment = async itemId => {
    try {
      const result = await window.electronAPI.attachments.select({ kind: 'any' });
      if (result?.canceled || !result?.file) return;
      updateSelectedField(itemId, '_rfqAttachment', result.file);
    } catch (error) {
      showToast(`选择备注附件失败：${error.message}`, 'error');
    }
  };

  const buildSelectionPayload = () => (activeProject?.items || []).map(item => {
    const candidate = selections[item.id];
    return {
      itemId: item.id,
      quoteEntryId: candidate?._quoteEntryId || selectedQuoteSetId,
      quoteItemIndex: candidate?._quoteItemIndex || 0,
      supplierName: candidate?.supplierName || '',
      selectedData: candidate || {}
    };
  });

  const handleSaveSelections = async () => {
    if (!activeProject) return;
    const missing = activeProject.items.filter(item => !selections[item.id]);
    if (missing.length > 0) {
      showToast(`还有 ${missing.length} 个产品未选择供应商`, 'warning');
      return;
    }
    try {
      const project = await window.electronAPI.rfq.saveSelections(
        activeProject.id,
        buildSelectionPayload()
      );
      setActiveProject(project);
      showToast('中选供应商已保存');
      await refreshLists(project.id);
    } catch (error) {
      showToast(`保存中选结果失败：${error.message}`, 'error');
    }
  };

  const handleGenerate = async () => {
    if (!activeProject) {
      showToast('请先上传或选择一个客户询价单', 'warning');
      return;
    }
    if (!selectedQuoteSet) {
      showToast('请先在数据录入页面生成一份供应商询价表', 'warning');
      return;
    }
    const missing = activeProject.items.filter(item => !selections[item.id]);
    if (missing.length > 0) {
      showToast(`请先为全部产品选择供应商，还缺 ${missing.length} 项`, 'warning');
      return;
    }
    setIsGenerating(true);
    try {
      const result = await window.electronAPI.rfq.generateFilled({
        projectId: activeProject.id,
        selections: buildSelectionPayload(),
        options: {
          exchangeRate: numberValue(exchangeRate) || 7.25,
          invoiceType
        }
      });
      if (result?.canceled) return;
      if (!result?.success) {
        showToast(result?.message || '询价单生成失败', 'error');
        return;
      }
      showToast(`已生成客户询价单：${result.filePath}`);
      setActiveProject(result.project);
      await refreshLists(activeProject.id);
    } catch (error) {
      showToast(`询价单生成失败：${error.message}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteProject = async project => {
    if (!confirm(`确定删除询价项目“${project.name}”吗？原始上传副本也会删除。`)) return;
    try {
      await window.electronAPI.rfq.deleteProject(project.id);
      setActiveProject(null);
      setSelections({});
      await refreshLists();
      showToast('询价项目已删除');
    } catch (error) {
      showToast(`删除失败：${error.message}`, 'error');
    }
  };

  if (isLoading) {
    return <div className="card empty-state">正在读取询价项目…</div>;
  }

  return (
    <div className="rfq-workspace">
      <div className="card rfq-intro">
        <div>
          <div className="rfq-beta-tag">BETA · 内测功能</div>
          <h2 className="card-title">客户询价单自动填入</h2>
          <p>
            上传客户询价单，完成供应商询价后，按产品人工勾选中选供应商，
            程序会保留原文件格式并生成一份已填写的新 Excel。
          </p>
        </div>
        <button className="btn btn-primary" onClick={handleImport} disabled={isImporting}>
          {isImporting ? '识别中…' : '上传客户询价单'}
        </button>
      </div>

      <div className="rfq-layout">
        <aside className="card rfq-sidebar">
          <div className="card-header">
            <h3 className="card-title">询价项目</h3>
            <span className="badge badge-primary">{projects.length}</span>
          </div>
          {projects.length === 0 ? (
            <div className="empty-state rfq-small-empty">
              <div className="empty-state-text">还没有询价项目</div>
              <div className="empty-state-desc">上传客户发来的 .xlsx 询价单开始</div>
            </div>
          ) : (
            <div className="rfq-project-list">
              {projects.map(project => (
                <button
                  key={project.id}
                  className={`rfq-project-item ${activeProject?.id === project.id ? 'active' : ''}`}
                  onClick={() => handleProjectSelect(project.id)}
                >
                  <strong>{project.name}</strong>
                  <span>{project.item_count} 项 · 已选 {project.selected_count}</span>
                  <em>{new Date(project.updated_at).toLocaleString('zh-CN')}</em>
                </button>
              ))}
            </div>
          )}
        </aside>

        <section className="rfq-main">
          {!activeProject ? (
            <div className="card empty-state">
              <div className="empty-state-icon">📥</div>
              <div className="empty-state-text">请上传或选择一个客户询价单</div>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">{activeProject.name}</h3>
                    <div className="text-sm text-muted">{activeProject.original_name}</div>
                  </div>
                  <div className="flex-center gap-8">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => onContinueInquiry?.(activeProject)}
                    >
                      去录入供应商报价
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteProject(activeProject)}
                    >
                      删除项目
                    </button>
                  </div>
                </div>
                <ProjectSummary project={activeProject} />
              </div>

              <div className="card rfq-settings">
                <div className="form-group">
                  <label className="form-label">用于筛选的供应商询价记录</label>
                  <select
                    className="form-select"
                    value={selectedQuoteSetId}
                    onChange={event => handleQuoteSetChange(event.target.value)}
                  >
                    <option value="">-- 请先生成供应商询价表 --</option>
                    {quoteSets.map(quoteSet => (
                      <option key={quoteSet.id} value={quoteSet.id}>
                        {quoteSet.name}（{(quoteSet.batches || []).reduce(
                          (sum, batch) => sum + (batch.items?.length || 0),
                          0
                        )} 条）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group rfq-rate-field">
                  <label className="form-label">USD/CNY 汇率</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.0001"
                    value={exchangeRate}
                    onChange={event => setExchangeRate(event.target.value)}
                  />
                </div>
                <div className="form-group rfq-invoice-field">
                  <label className="form-label">发票类型</label>
                  <select
                    className="form-select"
                    value={invoiceType}
                    onChange={event => setInvoiceType(event.target.value)}
                  >
                    <option value="special">专票（÷1.13）</option>
                    <option value="regular">普票</option>
                  </select>
                </div>
              </div>

              {!selectedQuoteSet ? (
                <div className="card empty-state">
                  <div className="empty-state-icon">📋</div>
                  <div className="empty-state-text">还没有可选择的供应商询价记录</div>
                  <div className="empty-state-desc">
                    请先进入“数据录入与生成”，生成一份供应商询价表。
                  </div>
                </div>
              ) : (
                <div className="rfq-item-list">
                  {activeProject.items.map(item => {
                    const ranked = sortCandidatesForTarget(item.data, candidates);
                    const selected = selections[item.id];
                    return (
                      <div className="card rfq-item-card" key={item.id}>
                        <div className="rfq-item-header">
                          <div className="rfq-line-number">{item.line_no}</div>
                          <div>
                            <strong>
                              {item.data.reference || item.data.code ||
                                item.data.description || `第 ${item.line_no} 项`}
                            </strong>
                            <p>{item.data.description || '未填写产品描述'}</p>
                          </div>
                          <div className="rfq-target-quantity">
                            数量 <strong>{item.data.quantity || '-'}</strong> {item.data.unit || ''}
                          </div>
                          <span className={`rfq-selection-status ${selected ? 'done' : ''}`}>
                            {selected ? `已选：${selected.supplierName || '未命名供应商'}` : '待选择'}
                          </span>
                        </div>

                        <div className="rfq-candidate-table-wrap">
                          <table className="data-table rfq-candidate-table">
                            <thead>
                              <tr>
                                <th className="rfq-check-column">选择</th>
                                <th>供应商</th>
                                <th>型号</th>
                                <th>人民币报价</th>
                                <th>换算美元单价</th>
                                <th>付款方式</th>
                                <th>交期</th>
                                <th>备注</th>
                                <th>匹配</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ranked.map(({ candidate, score }) => {
                                const checked =
                                  selected?._quoteEntryId === candidate._quoteEntryId &&
                                  selected?._quoteItemIndex === candidate._quoteItemIndex;
                                return (
                                  <tr
                                    key={`${candidate._quoteEntryId}-${candidate._quoteItemIndex}`}
                                    className={checked ? 'selected' : ''}
                                    onClick={() => toggleCandidate(item.id, candidate)}
                                  >
                                    <td className="rfq-check-column">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleCandidate(item.id, candidate)}
                                        onClick={event => event.stopPropagation()}
                                        aria-label={`选择${candidate.supplierName || '该供应商'}`}
                                      />
                                    </td>
                                    <td>{candidate.supplierName || '-'}</td>
                                    <td>{candidate.model || candidate.reference || '-'}</td>
                                    <td>
                                      ¥{numberValue(firstValue(
                                        candidate,
                                        ['price', 'totalPrice', 'totalRmb']
                                      )).toFixed(2)}
                                    </td>
                                    <td className="rfq-usd-value">
                                      ${calculateCandidateUsd(
                                        candidate,
                                        selectedQuoteSet,
                                        exchangeRate,
                                        invoiceType
                                      ).toFixed(2)}
                                    </td>
                                    <td>{candidate.paymentTerms || '-'}</td>
                                    <td>{candidate.deliveryTime || '-'}</td>
                                    <td>{candidate.notes || candidate.afterSales || '-'}</td>
                                    <td>
                                      <span className={`rfq-match-score ${score > 0 ? 'matched' : ''}`}>
                                        {score > 0 ? `${score} 分` : '人工判断'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {selected && (
                          <div className="rfq-note-editor">
                            <label>
                              <span>备注</span>
                              <textarea
                                className="form-input"
                                rows="2"
                                value={selected._rfqNotes ?? selected.notes ?? selected.afterSales ?? ''}
                                placeholder="填写要写入客户询价单的备注（可选）"
                                onChange={event => updateSelectedField(
                                  item.id,
                                  '_rfqNotes',
                                  event.target.value
                                )}
                              />
                            </label>
                            <div className="rfq-note-attachment">
                              <span>图片或文件（可选）</span>
                              {candidateAttachment(selected) ? (
                                <div className="attachment-cell">
                                  <div className={`attachment-file ${candidateAttachment(selected).kind === 'image' ? 'attachment-image' : ''}`}>
                                    {candidateAttachment(selected).name || '已选择附件'}
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => updateSelectedField(item.id, '_rfqAttachment', '')}
                                  >
                                    移除
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleSelectRfqAttachment(item.id)}
                                >
                                  + 添加图片或文件
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedQuoteSet && (
                <div className="rfq-actions">
                  <span>
                    已选择 {Object.keys(selections).length}/{activeProject.items.length} 项
                  </span>
                  <button className="btn btn-outline" onClick={handleSaveSelections}>
                    保存中选结果
                  </button>
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? '正在填写并生成…' : '填入并生成客户询价单'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
