import React, { useEffect, useMemo, useState } from 'react';
import { flattenQuoteSet, sortCandidatesForTarget } from '../utils/rfqMatching';

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

const normalizedLabel = value => String(value || '').replace(/[\s（）()_\-]/g, '').toLowerCase();
const quoteValueByLabel = (candidate, quoteSet, patterns) => {
  const direct = firstValue(candidate, ['price', 'totalPrice', 'totalRmb']);
  if (direct !== '') return direct;
  const labels = quoteSet?.fieldLabels || {};
  for (const [key, label] of Object.entries(labels)) {
    const normalized = normalizedLabel(label);
    if (patterns.some(pattern => normalized.includes(pattern)) && candidate?.[key] !== '') {
      return candidate?.[key];
    }
  }
  return '';
};

const candidateRmbValue = (candidate, quoteSet) => numberValue(quoteValueByLabel(
  candidate,
  quoteSet,
  ['含税含运', '含税运', '人民币总价', '含税价格', '出厂价']
));

const findAttachment = candidate => {
  const values = [candidate?._rfqAttachment, ...Object.values(candidate || {})];
  return values.find(value => value && typeof value === 'object' &&
    ['image', 'file'].includes(value.kind) && value.path) || null;
};

const STATUS_LABELS = {
  draft: '草稿', published: '已下发', in_progress: '进行中', review: '待审核',
  submitted: '已提交', completed: '已完成'
};

function cleanError(error) {
  return String(error?.message || error || '操作失败')
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, '');
}

function formatDate(value, withTime = false) {
  if (!value) return '未设置';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime ? date.toLocaleString() : date.toLocaleDateString();
}

function ImportTaskModal({ users, onClose, onImported }) {
  const [form, setForm] = useState({ title: '', taskNo: '', deadline: '', assignedUserIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quoteSets, setQuoteSets] = useState([]);
  const [selectedQuoteSetId, setSelectedQuoteSetId] = useState('');
  const [exchangeRate, setExchangeRate] = useState('7.25');
  const [invoiceType, setInvoiceType] = useState('special');
  const [selectingItemId, setSelectingItemId] = useState('');
  const toggleUser = id => setForm(current => ({
    ...current,
    assignedUserIds: current.assignedUserIds.includes(id)
      ? current.assignedUserIds.filter(value => value !== id)
      : [...current.assignedUserIds, id]
  }));
  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.collaboration.importTask(form);
      if (!result?.canceled) onImported(result);
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <form className="modal collab-import-modal" onSubmit={submit}>
        <h2 className="modal-title">下发新询价任务</h2>
        <p className="text-muted text-sm">填写任务信息后选择上级发来的Excel文件，系统会自动识别表头和产品明细。</p>
        <div className="form-row">
          <div className="form-group"><label className="form-label">任务名称（可选）</label><input className="form-input" value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="未填写时使用文件名" /></div>
          <div className="form-group"><label className="form-label">任务编号（可选）</label><input className="form-input" value={form.taskNo} onChange={event => setForm({ ...form, taskNo: event.target.value })} placeholder="系统可自动生成" /></div>
        </div>
        <div className="form-group"><label className="form-label">截止时间</label><input type="datetime-local" className="form-input" value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} /></div>
        <div className="form-group">
          <label className="form-label">重点负责人（不影响其他员工查看和填写）</label>
          <div className="collab-assignee-list">{users.filter(user => user.status === 'active').map(user => (
            <label key={user.id}><input type="checkbox" checked={form.assignedUserIds.includes(user.id)} onChange={() => toggleUser(user.id)} /> {user.displayName}</label>
          ))}</div>
        </div>
        {error && <div className="collab-form-error">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn btn-outline" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy}>{busy ? '正在识别并上传…' : '选择Excel并下发'}</button></div>
      </form>
    </div>
  );
}

function TaskList({ tasks, users, user, onSelect, onRefresh, searchQuery, batchMode, selectedIds, onToggleSelect }) {
  const [filter, setFilter] = useState('active');
  const visible = tasks.filter(task => {
    let match = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      match = (task.title || '').toLowerCase().includes(q)
        || (task.taskNo || '').toLowerCase().includes(q)
        || (task.requester || '').toLowerCase().includes(q)
        || (task.country || '').toLowerCase().includes(q);
    }
    if (filter === 'all') return match;
    if (filter === 'mine') return match && (task.assignedUserIds || []).includes(user.id);
    if (filter === 'review') return match && task.status === 'review';
    return match && !['completed'].includes(task.status);
  });
  const deadlineClass = task => {
    if (!task.deadline || task.status === 'completed') return '';
    const d = new Date(task.deadline);
    if (d < new Date()) return 'deadline-late';
    if (d < new Date(Date.now() + 86400000)) return 'deadline-soon';
    return '';
  };
  const userNames = ids => (ids || []).map(id => users.find(userItem => userItem.id === id)?.displayName).filter(Boolean).join('、') || '所有员工';
  return (
    <>
      <div className="collab-workspace-head">
        <div><h1>共享询价任务</h1><p>所有员工查看并填写同一份数据，系统记录每次修改。</p></div>
        <button className="btn btn-outline" onClick={onRefresh}>刷新任务</button>
      </div>
      <div className="collab-task-filters">
        <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>进行中的任务</button>
        <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>重点分配给我</button>
        {user.role === 'admin' && <button className={filter === 'review' ? 'active' : ''} onClick={() => setFilter('review')}>等待我审核</button>}
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
      </div>
      {visible.length === 0 ? <div className="card empty-state"><div className="empty-state-icon">📋</div><div className="empty-state-text">当前没有符合条件的询价任务</div></div> : (
        <div className="collab-task-grid">{visible.map(task => {
          const percent = task.itemCount ? Math.round(task.completedCount / task.itemCount * 100) : 0;
          const dc = deadlineClass(task);
          return (
            <div key={task.id} className={`collab-task-card-wrap ${dc}`}>
              {batchMode && <input type="checkbox" className="collab-batch-check" checked={selectedIds.has(task.id)} onChange={() => onToggleSelect(task.id)} />}
              <button className="collab-task-card" onClick={() => { if (!batchMode) onSelect(task.id); }}>
              <div className="collab-task-card-head"><span className={`collab-status status-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span><span>{task.taskNo}</span></div>
              <strong>{task.title}</strong>
              <div className="collab-task-meta"><span>国家：{task.country || '未填写'}</span><span>请求人：{task.requester || '未填写'}</span><span>客户：{task.clientName || '未填写'}</span><span className={dc ? 'deadline-highlight' : ''}>截止：{formatDate(task.deadline, true)}</span></div>
              <div className="collab-progress"><span style={{ width: `${percent}%` }} /></div>
              <div className="collab-task-footer"><span>已填写 {task.completedCount}/{task.itemCount}</span><span>负责人：{userNames(task.assignedUserIds)}</span></div>
            </button></div>
          );
        })}</div>
      )}
      {batchMode && (
        <div className="collab-batch-bar">
          <span>{selectedIds.size} 项已选</span>
          <button className="btn btn-outline btn-sm" onClick={() => { setBatchMode(false); selectedIds.clear(); }}>取消</button>
        </div>
      )}
    </>
  );
}

function TaskDetail({ taskId, user, onBack, onChanged, onOpenExcelTool }) {
  const [task, setTask] = useState(null);
  const [items, setItems] = useState([]);
  const [audit, setAudit] = useState([]);
  const [tab, setTab] = useState('entry');
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [quoteSets, setQuoteSets] = useState([]);
  const [selectedQuoteSetId, setSelectedQuoteSetId] = useState('');
  const [exchangeRate, setExchangeRate] = useState('7.25');
  const [invoiceType, setInvoiceType] = useState('special');
  const [selectingItemId, setSelectingItemId] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');

  const load = async () => {
    setError('');
    try {
      const result = await window.electronAPI.collaboration.getTask(taskId);
      setTask(result.task || null);
      setItems(result.items || []);
    } catch (e) {
      setError(cleanError(e));
      setTask(null);
    }
  };
  const loadAudit = async () => {
    try {
      const result = await window.electronAPI.collaboration.getTaskAudit(taskId);
      setAudit(result?.audit || []);
    } catch (_) {
      setAudit([]);
    }
  };
  useEffect(() => {
    load();
    window.electronAPI.rfq.listQuoteSets().then(result => {
      const next = result || [];
      setQuoteSets(next);
      if (next.length) {
        setSelectedQuoteSetId(next[0].id);
        setExchangeRate(String(next[0].options?.exchangeRate || 7.25));
        setInvoiceType(next[0].options?.invoiceType === 'regular' ? 'regular' : 'special');
      }
    }).catch(() => setQuoteSets([]));
    const keyHandler = e => {
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); const dirty = items.find(i => i.dirty); if (dirty) saveItem(dirty); }
    };
    window.addEventListener('keydown', keyHandler);
    return () => window.removeEventListener('keydown', keyHandler);
  }, [taskId]);
  useEffect(() => { if (tab === 'history') loadAudit(); }, [tab]);

  const updateLocalItem = (id, field, value) => setItems(current => current.map(item => item.id === id ? { ...item, [field]: value, dirty: true } : item));
  const saveItem = async item => {
    setSavingId(item.id);
    setError('');
    setMessage('');
    try {
      const result = await window.electronAPI.collaboration.updateTaskItem(task.id, item.id, {
        fobUsd: item.fobUsd,
        totalRmb: item.totalRmb,
        exchangeRate: item.exchangeRate,
        invoiceType: item.invoiceType,
        selectedSupplier: item.selectedSupplier,
        selectedQuote: item.selectedQuote,
        remarks: item.remarks,
        rowVersion: item.rowVersion
      });
      setItems(current => current.map(row => row.id === item.id ? { ...row, ...result, dirty: false, updatedByName: user.displayName } : row));
      setMessage(`第${item.lineNo}项已保存`);
      onChanged();
    } catch (e) {
      setError(cleanError(e));
    } finally {
      setSavingId('');
    }
  };
  const selectedQuoteSet = useMemo(
    () => quoteSets.find(entry => entry.id === selectedQuoteSetId) || null,
    [quoteSets, selectedQuoteSetId]
  );
  const candidates = useMemo(
    () => selectedQuoteSet ? flattenQuoteSet(selectedQuoteSet) : [],
    [selectedQuoteSet]
  );
  const chooseQuoteSet = id => {
    setSelectedQuoteSetId(id);
    const quoteSet = quoteSets.find(entry => entry.id === id);
    setExchangeRate(String(quoteSet?.options?.exchangeRate || 7.25));
    setInvoiceType(quoteSet?.options?.invoiceType === 'regular' ? 'regular' : 'special');
  };
  const applyCandidate = async (item, candidate) => {
    const totalRmb = candidateRmbValue(candidate, selectedQuoteSet);
    const rate = numberValue(exchangeRate) || 7.25;
    const fobUsd = totalRmb / rate / (invoiceType === 'special' ? 1.13 : 1);
    if (!totalRmb) { setError('该供应商记录没有可用的“含税运人民币”价格'); return; }
    setSavingId(item.id);
    setError('');
    try {
      const remarks = candidate._rfqNotes ?? candidate.notes ?? candidate.afterSales ?? '';
      const result = await window.electronAPI.collaboration.updateTaskItem(task.id, item.id, {
        fobUsd,
        totalRmb,
        exchangeRate: rate,
        invoiceType,
        selectedSupplier: candidate.supplierName || '',
        selectedQuote: candidate,
        remarks,
        rowVersion: item.rowVersion
      });
      const attachment = findAttachment(candidate);
      const alreadyUploaded = attachment && (item.attachments || []).some(file => file.name === attachment.name);
      if (attachment && !alreadyUploaded) {
        await window.electronAPI.collaboration.uploadTaskAttachmentPath(task.id, item.id, attachment.path);
      }
      setSelectingItemId('');
      setMessage(`第${item.lineNo}项已选用“${candidate.supplierName || '未命名供应商'}”，FOB自动计算为 $${fobUsd.toFixed(2)}`);
      await load();
      onChanged();
    } catch (e) { setError(cleanError(e)); } finally { setSavingId(''); }
  };
  const attach = async item => {
    try {
      const result = await window.electronAPI.collaboration.uploadTaskAttachment(task.id, item.id);
      if (!result?.canceled) {
        setMessage('附件上传成功');
        await load();
      }
    } catch (e) { setError(cleanError(e)); }
  };
  const navigateGrid = (event, rowIndex, fieldIndex) => {
    const directions = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (!directions[event.key]) return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
    const [rowDelta, fieldDelta] = directions[event.key];
    const target = document.querySelector(`[data-collab-cell="${rowIndex + rowDelta}-${fieldIndex + fieldDelta}"]`);
    if (target) { event.preventDefault(); target.focus(); target.select?.(); }
  };
  const submitReview = async () => {
    if (items.some(item => item.dirty)) { setError('还有未保存的修改，请先保存对应行'); return; }
    await window.electronAPI.collaboration.submitTaskReview(task.id);
    setMessage('已提交负责人审核，当前版本仍然可以继续修改');
    await load();
    onChanged();
  };
  const snapshot = async () => {
    const result = await window.electronAPI.collaboration.createTaskSnapshot(task.id);
    setMessage(`已保存第${result.version}次正式提交快照，当前数据仍可继续修改`);
    await load();
    onChanged();
  };
  const revertItem = async item => {
    try {
      await window.electronAPI.collaboration.revertTaskItem(task.id, item.id);
      setMessage(`第${item.lineNo}项已还原到上一个版本`);
      await load();
      onChanged();
    } catch (e) { setError(cleanError(e)); }
  };
  const downloadCsv = async () => {
    await window.electronAPI.collaboration.exportTaskCsv(task.id);
  };
  const loadComments = async () => {
    try {
      const r = await window.electronAPI.collaboration.listTaskComments(task.id);
      setComments(r.comments || []);
    } catch (_) { setComments([]); }
  };
  const addComment = async () => {
    if (!commentText.trim()) return;
    const r = await window.electronAPI.collaboration.addTaskComment(task.id, commentText.trim());
    setComments(c => [...c, r]);
    setCommentText('');
  };
  const exportCompleted = async () => {
    if (items.some(item => item.dirty)) { setError('还有未保存的修改，请先保存对应行再导出'); return; }
    setError('');
    try {
      const result = await window.electronAPI.collaboration.exportCompletedTask(task);
      if (!result?.canceled) setMessage('已导出填写完成的询价单');
    } catch (e) { setError(cleanError(e)); }
  };

  if (!task) return <div className="collab-loading">正在加载任务…</div>;
  return (
    <div className="collab-task-detail">
      <div className="collab-detail-toolbar"><button className="btn btn-outline" onClick={onBack}>← 返回任务列表</button><div><span className={`collab-status status-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span><span className="text-muted text-sm"> 当前版本 V{task.currentVersion}</span></div></div>
      <section className="card collab-task-summary">
        <div className="card-header"><div><div className="text-sm text-muted">{task.taskNo}</div><h1>{task.title}</h1></div><div className="collab-export-actions"><button className="btn btn-outline" onClick={() => window.electronAPI.collaboration.downloadTaskSource(task)}>下载原始询价单</button><button className="btn btn-outline" onClick={downloadCsv}>导出CSV</button>{user.role === 'admin' && <button className="btn btn-primary" onClick={exportCompleted}>导出已填写询价单</button>}</div></div>
        <div className="collab-summary-grid"><div><span>请求人</span><strong>{task.requester || '未填写'}</strong></div><div><span>国家</span><strong>{task.country || '未填写'}</strong></div><div><span>客户</span><strong>{task.clientName || '未填写'}</strong></div><div><span>申请日期</span><strong>{formatDate(task.requestDate)}</strong></div><div><span>进口方式</span><strong>{task.importType || '未填写'}</strong></div><div><span>交付方式</span><strong>{task.deliveryType || '未填写'}</strong></div><div><span>付款方式</span><strong>{task.paymentType || '未填写'}</strong></div><div><span>截止时间</span><strong>{formatDate(task.deadline, true)}</strong></div></div>
      </section>
      <div className="collab-detail-tabs"><button className={tab === 'entry' ? 'active' : ''} onClick={() => setTab('entry')}>询价填写</button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>修改记录</button><button className={tab === 'comments' ? 'active' : ''} onClick={() => { setTab('comments'); loadComments(); }}>讨论</button></div>
      {message && <div className="collab-form-success">{message}</div>}
      {error && <div className="collab-form-error">{error}</div>}
      {tab === 'entry' ? (
        <section className="card collab-entry-card">
          <div className="card-header"><div><h2 className="card-title">产品明细</h2><p className="text-muted text-sm">从本机生成的供应商表勾选后，含税运人民币、FOB、备注和附件会同步到共享任务。</p></div><div className="collab-export-actions"><button className="btn btn-outline" onClick={onOpenExcelTool}>打开Excel工具录入报价</button><button className="btn btn-outline" onClick={load}>刷新最新数据</button></div></div>
          <div className="collab-quote-source-bar">
            <label><span>调用本机已生成的供应商表</span><select className="form-select" value={selectedQuoteSetId} onChange={event => chooseQuoteSet(event.target.value)}><option value="">请选择供应商询价记录</option>{quoteSets.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            <label><span>汇率（CNY/USD）</span><input className="form-input" type="number" min="0.0001" step="0.0001" value={exchangeRate} onChange={event => setExchangeRate(event.target.value)} /></label>
            <label><span>发票类型</span><select className="form-select" value={invoiceType} onChange={event => setInvoiceType(event.target.value)}><option value="special">专票（除以1.13）</option><option value="regular">普票</option></select></label>
          </div>
          <div className="table-container collab-shared-table-wrap"><table className="data-table collab-shared-table">
            <thead><tr><th>#</th><th>产品描述</th><th>代码</th><th className="number">数量</th><th>单位</th><th>中选供应商</th><th>含税运人民币</th><th>FOB（USD）</th><th>备注</th><th>附件</th><th>最后修改</th><th>操作</th></tr></thead>
            <tbody>{items.map((item, rowIndex) => {
              return <tr key={item.id} className={item.dirty ? 'dirty' : ''}><td>{item.lineNo}</td><td className="collab-description-cell">{item.description}</td><td>{item.productCode || '—'}</td><td className="number">{item.quantity ?? '—'}</td><td>{item.unit || '—'}</td><td><strong>{item.selectedSupplier || '未选择'}</strong><button className="btn btn-outline btn-sm collab-pick-supplier" disabled={!selectedQuoteSet} onClick={() => setSelectingItemId(item.id)}>从表格勾选</button></td><td className="number">{item.totalRmb == null ? '—' : `¥${Number(item.totalRmb).toFixed(2)}`}</td><td><input className="form-input" type="number" min="0" step="0.01" value={item.fobUsd ?? ''} data-collab-cell={`${rowIndex}-0`} onKeyDown={event => navigateGrid(event, rowIndex, 0)} onChange={event => updateLocalItem(item.id, 'fobUsd', event.target.value)} /></td><td><input className="form-input" value={item.remarks || ''} data-collab-cell={`${rowIndex}-1`} onKeyDown={event => navigateGrid(event, rowIndex, 1)} onChange={event => updateLocalItem(item.id, 'remarks', event.target.value)} /></td><td><div className="collab-attachment-list">{(item.attachments || []).map(file => <button key={file.id} className="collab-attachment-link" onClick={() => { if (file.kind === 'image') { setPreviewImage(`/api/tasks/${encodeURIComponent(task.id)}/items/${encodeURIComponent(item.id)}/attachments/${encodeURIComponent(file.id)}`); } else { window.electronAPI.collaboration.downloadTaskAttachment(task.id, item.id, file); } }}>{file.kind === 'image' ? '🖼' : '📎'} {file.name}</button>)}<button className="btn btn-outline btn-sm" onClick={() => attach(item)}>＋附件</button></div></td><td><span className="text-sm">{item.updatedByName || '—'}</span><span className="text-sm text-muted collab-block">{formatDate(item.updatedAt, true)}</span></td><td><button className="btn btn-primary btn-sm" disabled={!item.dirty || savingId === item.id} onClick={() => saveItem(item)}>{savingId === item.id ? '保存中…' : '保存本行'}</button><button className="btn btn-outline btn-sm" style={{marginLeft:4}} onClick={() => revertItem(item)} title="还原到上一个版本">还原</button></td></tr>;
            })}</tbody>
          </table></div>
          {selectingItemId && (() => {
            const target = items.find(item => item.id === selectingItemId);
            const ranked = sortCandidatesForTarget({ ...(target?.source || {}), description: target?.description, code: target?.productCode }, candidates);
            return <div className="collab-candidate-picker"><div className="card-header"><div><h3>为第{target?.lineNo}项勾选供应商</h3><p className="text-muted text-sm">数据来自“{selectedQuoteSet?.name}”，按型号和描述优先排序。</p></div><button className="btn btn-outline btn-sm" onClick={() => setSelectingItemId('')}>关闭</button></div><div className="table-container"><table className="data-table"><thead><tr><th>选择</th><th>供应商</th><th>型号</th><th>含税运人民币</th><th>自动FOB</th><th>备注</th></tr></thead><tbody>{ranked.map(({ candidate, score }, idx) => { const rmb = candidateRmbValue(candidate, selectedQuoteSet); const fob = rmb / (numberValue(exchangeRate) || 7.25) / (invoiceType === 'special' ? 1.13 : 1); const priceRank = rmb > 0 ? ranked.filter(c => candidateRmbValue(c.candidate, selectedQuoteSet) > 0).sort((a, b) => candidateRmbValue(a.candidate, selectedQuoteSet) - candidateRmbValue(b.candidate, selectedQuoteSet)).findIndex(c => c.candidate === candidate) + 1 : null; return <tr key={`${candidate._quoteEntryId}-${candidate._quoteItemIndex}`}><td><button className="btn btn-primary btn-sm" disabled={savingId === target?.id} onClick={() => applyCandidate(target, candidate)}>✓ 选用</button></td><td>{candidate.supplierName || '—'}{priceRank > 0 && <span className="rfq-price-rank" style={{marginLeft:6,color:priceRank===1?'#27AE60':priceRank===2?'#F39C12':'#888',fontSize:11,fontWeight:600}}>{priceRank===1?'最低':priceRank===2?'第2':'#'+priceRank}</span>}</td><td>{candidate.model || candidate.reference || '—'}</td><td>¥{rmb.toFixed(2)}</td><td>${fob.toFixed(2)}</td><td>{candidate.notes || candidate.afterSales || '—'}{score > 0 && <span className="rfq-match-score matched"> {score}分</span>}</td></tr>; })}</tbody></table></div></div>;
          })()}
          <div className="collab-review-actions"><span>提交后仍可继续修改；正式提交会保留不可覆盖的历史快照。</span>{user.role === 'admin' ? <button className="btn btn-success btn-lg" onClick={snapshot}>审核通过并保存提交快照</button> : <button className="btn btn-success btn-lg" onClick={submitReview}>提交负责人审核</button>}</div>
        </section>
      ) : (
        tab === 'history' && <section className="card"><div className="card-header"><h2 className="card-title">修改记录</h2><button className="btn btn-outline" onClick={loadAudit}>刷新</button></div>{audit.length === 0 ? <div className="empty-state"><div className="empty-state-text">暂无修改记录</div></div> : <div className="collab-audit-list">{audit.map(record => <div key={record.id}><time>{formatDate(record.createdAt, true)}</time><strong>{record.userName || '系统'}</strong><span>{record.action === 'update' ? '修改了询价数据' : '导入了询价任务'}</span></div>)}</div>}</section>
      )}
      {tab === 'comments' && (
          <section className="card">
            <div className="card-header"><h2 className="card-title">任务讨论</h2></div>
            {comments.length === 0 ? <div className="empty-state"><div className="empty-state-text">暂无讨论，开始第一条评论</div></div> : <div className="collab-comments-list">{comments.map(c => <div key={c.id} className="collab-comment"><strong>{c.userName}</strong><span>{c.content}</span><time>{formatDate(c.createdAt, true)}</time></div>)}</div>}
            <div className="collab-comment-input">
              <input className="form-input" placeholder="输入评论…" value={commentText} onChange={e => setCommentText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && commentText.trim()) { addComment(); } }} />
              <button className="btn btn-primary btn-sm" onClick={addComment} disabled={!commentText.trim()}>发送</button>
            </div>
          </section>
        )}
      )}
      {previewImage && <div className="modal-overlay" onClick={() => setPreviewImage(null)}><div className="collab-image-preview" onClick={e => e.stopPropagation()}><button className="release-notes-close" onClick={() => setPreviewImage(null)}>×</button><img src={previewImage} alt="预览" style={{maxWidth:'90vw',maxHeight:'85vh',borderRadius:8}} /></div></div>}
    </div>
  );
}

export default function CollaborationWorkspace({ user, onNotificationsChanged, onOpenExcelTool, searchQuery }) {
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [batchMode, setBatchMode] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [taskResult, userResult, statResult] = await Promise.all([
        window.electronAPI.collaboration.listTasks(),
        window.electronAPI.collaboration.listUsers(),
        window.electronAPI.collaboration.getTaskStats().catch(() => null)
      ]);
      setTasks(taskResult.tasks || []);
      setUsers(userResult.users || []);
      if (statResult) setStats(statResult);
    } catch (e) { setError(cleanError(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const activeTasks = useMemo(() => tasks.filter(task => task.status !== 'completed').length, [tasks]);

  if (selectedTaskId) return <TaskDetail taskId={selectedTaskId} user={user} onBack={() => { setSelectedTaskId(''); load(); }} onChanged={() => { load(); onNotificationsChanged(); }} onOpenExcelTool={onOpenExcelTool} />;
  const statusCounts = { drafts: tasks.filter(t => t.status === 'draft').length, published: tasks.filter(t => t.status === 'published').length, inProgress: tasks.filter(t => t.status === 'in_progress').length, review: tasks.filter(t => t.status === 'review').length, completed: tasks.filter(t => t.status === 'completed').length };
  return (
    <div>
      {user.role === 'admin' && <div className="collab-admin-action-bar"><div><strong>管理员工作台</strong><span>当前共有 {activeTasks} 个未完成任务</span></div><button className="btn btn-primary btn-lg" onClick={() => setShowImport(true)}>＋ 上传并下发询价单</button></div>}
      {stats && (
        <div className="collab-stats-bar">
          {statusCounts.drafts > 0 && <span>草稿 {statusCounts.drafts}</span>}
          {statusCounts.inProgress > 0 && <span>进行中 {statusCounts.inProgress}</span>}
          {statusCounts.review > 0 && <span className="review">待审核 {statusCounts.review}</span>}
          {statusCounts.completed > 0 && <span className="done">已完成 {statusCounts.completed}</span>}
          <span className="fill">填写进度 {stats.filledItems}/{stats.totalItems}</span>
        </div>
      )}
      {message && <div className="collab-form-success">{message}</div>}
      {error && <div className="collab-form-error">{error}</div>}
      {loading ? <div className="collab-loading">正在读取共享任务…</div> : <TaskList tasks={tasks} users={users} user={user} onSelect={setSelectedTaskId} onRefresh={load} searchQuery={searchQuery} batchMode={batchMode} selectedIds={selectedIds} onToggleSelect={id => { const s = new Set(selectedIds); if (s.has(id)) s.delete(id); else s.add(id); setSelectedIds(s); }} />}
      {user.role === 'admin' && !loading && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => { setBatchMode(!batchMode); setSelectedIds(new Set()); }}>{batchMode ? '退出批量' : '批量操作'}</button>
        </div>
      )}
      {showImport && <ImportTaskModal users={users} onClose={() => setShowImport(false)} onImported={async result => { setShowImport(false); setMessage(`任务“${result.title}”已下发，共${result.itemCount}项产品。`); await load(); onNotificationsChanged(); }} />}
    </div>
  );
}
