import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  getGridNavigationTarget,
  parseClipboardGrid,
  applyGridPaste
} from '../utils/gridNavigation';
import {
  inferSystemFieldKey,
  normalizePersistedMapping
} from '../../shared/templateMappings';

const NUMERIC_FIELDS = new Set([
  'price', 'cost', 'profit', 'profitRate', 'totalPrice', 'quantity',
  'usdPrice', 'usdTotalPrice', 'usdCost'
]);

const cleanTemplateField = value => String(value || '').replace(/\{\{|\}\}/g, '').trim();
const normalizeTemplateField = value => cleanTemplateField(value)
  .toLowerCase()
  .replace(/[\s/\\()（）【】\[\]：:、,_-]/g, '');

const isUsdCostTemplateField = field => {
  const normalized = normalizeTemplateField(field?.label || field);
  return field?.key === 'usdCost' ||
    normalized.includes('美金成本') ||
    normalized.includes('美元成本') ||
    normalized.includes('usdcost');
};

const isLandedPriceTemplateField = field => {
  const normalized = normalizeTemplateField(field?.label || field);
  return normalized.includes('含税含运');
};

const inferAttachmentType = (label, configuredType) => {
  if (configuredType === 'image' || configuredType === 'file') return configuredType;
  const normalized = normalizeTemplateField(label);
  if (/(图片|照片|图像|产品图|厂房图|image|photo)/i.test(normalized)) return 'image';
  if (/(附件|pdf|文档|文件|证书|执照|资质)/i.test(normalized)) return 'file';
  return null;
};

const DEFAULT_ITEM = {
  supplierName: '', productName: '', model: '',
  price: '', cost: '', quantity: '1',
  deliveryTime: '', paymentTerms: '', afterSales: '',
  warranty: '', notes: ''
};

export default function DataEntryForm({ templates, selectedTemplate, onTemplateSelect, showToast }) {
  // 当前编辑行
  const [dataItems, setDataItems] = useState([{ ...DEFAULT_ITEM }]);
  // 品类
  const [category, setCategory] = useState('');
  // 已保存的批次
  const [batches, setBatches] = useState([]);
  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  // 存储位置
  const [saveFolder, setSaveFolder] = useState('');
  const [fileName, setFileName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  // 汇率与发票
  const [exchangeRate, setExchangeRate] = useState('7.25');
  const [invoiceType, setInvoiceType] = useState('special'); // 'special'=专票, 'regular'=普票
  const [isOpeningExisting, setIsOpeningExisting] = useState(false);
  const [loadedSource, setLoadedSource] = useState(null);
  const [editingBatchId, setEditingBatchId] = useState(null);
  const [activeFields, setActiveFields] = useState([]);
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [exchangeRateInfo, setExchangeRateInfo] = useState(null);
  const [draftStatus, setDraftStatus] = useState('');
  const draftReadyRef = useRef(false);
  const suppressDraftRestoreRef = useRef(false);

  useEffect(() => {
    let canceled = false;
    if (!selectedTemplate) {
      setActiveFields([]);
      return () => { canceled = true; };
    }

    setIsLoadingFields(true);
    (async () => {
      try {
        const [remoteStructure, remoteMappings, systemFields] = await Promise.all([
          window.electronAPI.templates.getStructure(selectedTemplate.id),
          window.electronAPI.fieldMapping.get(selectedTemplate.id),
          window.electronAPI.fieldMapping.getSystemFields()
        ]);
        if (canceled) return;
        // 老模板可能没有单独的 structure/mappings 接口数据，但模板列表已携带快照。
        // 兼容两种来源，避免“模板已选中但录入区为空”。
        const structure = Array.isArray(remoteStructure?.columns)
          ? remoteStructure
          : (Array.isArray(selectedTemplate.structure?.columns) ? selectedTemplate.structure : {});
        const persistedMappings = Array.isArray(remoteMappings) && remoteMappings.length > 0
          ? remoteMappings
          : (Array.isArray(selectedTemplate.mappings) ? selectedTemplate.mappings : []);
        const mappingList = persistedMappings
          .map(mapping => normalizePersistedMapping(mapping, systemFields || []))
          .filter(mapping => mapping.templateField && mapping.systemField);
        const structureColumns = Array.isArray(structure?.columns) ? structure.columns : [];
        const columns = structureColumns.length > 0
          ? structureColumns
          : mappingList.map((mapping, index) => ({
            header: mapping.templateField,
            colNumber: index + 1,
            width: 12
          }));
        const fields = columns.map((column, index) => {
          const templateLabel = cleanTemplateField(column.header);
          const normalizedLabel = normalizeTemplateField(templateLabel);
          const mapping = mappingList.find(item =>
            cleanTemplateField(item.templateField) === templateLabel ||
            normalizeTemplateField(item.templateField) === normalizedLabel
          );
          const calculatedUsdCost = isUsdCostTemplateField(templateLabel);
          const landedPrice = isLandedPriceTemplateField(templateLabel);
          const inferredSystemField = inferSystemFieldKey(templateLabel, systemFields || [], { allowUnknown: false });
          if (!mapping?.systemField && !inferredSystemField && !calculatedUsdCost && !landedPrice) return null;
          const systemField = calculatedUsdCost
            ? 'usdCost'
            : landedPrice ? 'price' : (mapping?.systemField || inferredSystemField);
          const systemFieldDefinition = (systemFields || []).find(field => field.key === systemField);
          const attachmentType = inferAttachmentType(templateLabel, systemFieldDefinition?.dataType);
          const width = Math.min(Math.max((Number(column.width) || 12) * 8, 70), 220);
          return {
            id: `${column.colNumber || index + 1}-${systemField}`,
            key: systemField,
            label: templateLabel,
            width: `${Math.round(width)}px`,
            type: attachmentType || (
              NUMERIC_FIELDS.has(systemField) || systemFieldDefinition?.dataType === 'number'
                ? 'number'
                : 'text'
            )
          };
        }).filter(Boolean);
        setActiveFields(fields);
      } catch (error) {
        if (!canceled) {
          setActiveFields([]);
          showToast('读取模板字段失败: ' + error.message, 'error');
        }
      } finally {
        if (!canceled) setIsLoadingFields(false);
      }
    })();
    return () => { canceled = true; };
  }, [selectedTemplate?.id, showToast]);

  useEffect(() => {
    let canceled = false;
    draftReadyRef.current = false;
    setDraftStatus('');
    if (!selectedTemplate?.id) return () => { canceled = true; };

    if (suppressDraftRestoreRef.current) {
      suppressDraftRestoreRef.current = false;
      draftReadyRef.current = true;
      return () => { canceled = true; };
    }

    (async () => {
      try {
        const draft = await window.electronAPI.draft.get(selectedTemplate.id);
        if (canceled) return;
        const payload = draft?.payload;
        if (payload) {
          setDataItems(Array.isArray(payload.dataItems) && payload.dataItems.length > 0
            ? payload.dataItems.map(item => ({ ...DEFAULT_ITEM, ...item }))
            : [{ ...DEFAULT_ITEM }]);
          setBatches(Array.isArray(payload.batches) ? payload.batches : []);
          setCategory(payload.category || '');
          setSaveFolder(payload.saveFolder || '');
          setFileName(payload.fileName || '');
          setExchangeRate(payload.exchangeRate || '7.25');
          setInvoiceType(payload.invoiceType || 'special');
          setEditingBatchId(payload.editingBatchId ?? null);
          setLoadedSource(payload.loadedSource || null);
          setDraftStatus(`已恢复 ${new Date(draft.updatedAt).toLocaleString('zh-CN')} 的草稿`);
          showToast('已恢复上次未完成的录入草稿');
        }
      } catch (error) {
        if (!canceled) showToast(`恢复草稿失败：${error.message}`, 'warning');
      } finally {
        if (!canceled) draftReadyRef.current = true;
      }
    })();

    return () => { canceled = true; };
  }, [selectedTemplate?.id, showToast]);

  useEffect(() => {
    if (!selectedTemplate?.id || !draftReadyRef.current) return undefined;
    const timer = setTimeout(async () => {
      try {
        const result = await window.electronAPI.draft.save(selectedTemplate.id, {
          dataItems,
          batches,
          category,
          saveFolder,
          fileName,
          exchangeRate,
          invoiceType,
          editingBatchId,
          loadedSource
        });
        setDraftStatus(`草稿已自动保存 ${new Date(result.updatedAt).toLocaleTimeString('zh-CN')}`);
      } catch (error) {
        setDraftStatus('草稿自动保存失败');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [
    selectedTemplate?.id,
    dataItems,
    batches,
    category,
    saveFolder,
    fileName,
    exchangeRate,
    invoiceType,
    editingBatchId,
    loadedSource
  ]);

  const itemHasData = item => {
    const fieldsToCheck = activeFields.filter(field => field.key !== 'quantity');
    const effectiveFields = fieldsToCheck.length > 0 ? fieldsToCheck : activeFields;
    return effectiveFields.some(field => {
      const value = item?.[field.key];
      return value !== undefined && value !== null && String(value).trim() !== '';
    });
  };

  const getFieldDisplayValue = (item, field) => {
    if (isUsdCostTemplateField(field)) {
      const totalPriceField = activeFields.find(activeField =>
        normalizeTemplateField(activeField.label).includes('含税含运')
      ) || activeFields.find(activeField => activeField.key === 'price')
        || activeFields.find(activeField => activeField.key === 'totalPrice');
      const totalPrice = parseFloat(item?.[totalPriceField?.key || 'price']) || 0;
      const rate = parseFloat(exchangeRate) || 7.25;
      const invoiceDivisor = invoiceType === 'special' ? 1.13 : 1;
      return (totalPrice / rate / invoiceDivisor).toFixed(2);
    }
    return item?.[field.key] ?? '';
  };

  useEffect(() => {
    // 通过 IPC 获取桌面路径，避免渲染进程直接访问 Node API
    (async () => {
      try {
        if (window.electronAPI && window.electronAPI.app) {
          const desktop = await window.electronAPI.app.getDesktopPath();
          setSaveFolder(desktop || '');
        }
      } catch (e) { /* 无桌面路径也正常运行 */ }
    })();
    const dateStr = new Date().toISOString().slice(0, 10);
    setFileName(`生成表格_${dateStr}.xlsx`);
  }, []);

  useEffect(() => {
    refreshTodayRate(false, false);
    const timer = setInterval(() => refreshTodayRate(false, false), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshTodayRate = async (force = false, notify = true) => {
    setIsFetchingRate(true);
    try {
      const result = await window.electronAPI.exchangeRate.getToday({ force });
      if (result.success) {
        setExchangeRate(String(Number(result.rate).toFixed(4)).replace(/0+$/, '').replace(/\.$/, ''));
        setExchangeRateInfo({
          referenceDate: result.referenceDate,
          fetchedAt: result.fetchedAt,
          source: result.source
        });
        if (notify) showToast(`今日汇率已更新：1 USD = ${Number(result.rate).toFixed(4)} CNY`);
      } else if (notify) {
        showToast((result.message || '今日汇率获取失败') + '，已保留手动汇率', 'warning');
      }
    } catch (error) {
      if (notify) showToast('今日汇率获取失败，已保留手动汇率', 'warning');
    } finally {
      setIsFetchingRate(false);
    }
  };

  // ---------- 文件夹操作 ----------
  const handleSelectFolder = async () => {
    try {
      const folder = await window.electronAPI.dialog.selectFolder();
      if (folder) setSaveFolder(folder);
    } catch (e) { showToast('选择文件夹失败', 'error'); }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) { showToast('请输入文件夹名称', 'warning'); return; }
    if (!saveFolder) { showToast('请先选择父文件夹', 'warning'); return; }
    try {
      const result = await window.electronAPI.dialog.createFolder(saveFolder, newFolderName.trim());
      if (result.success) { setSaveFolder(result.path); showToast('文件夹已创建'); }
      else { showToast(result.message || '创建失败', 'error'); }
      setNewFolderName(''); setShowNewFolderInput(false);
    } catch (e) { showToast('创建文件夹失败', 'error'); }
  };

  // ---------- 行操作 ----------
  const handleInputChange = (rowIndex, field, value) => {
    setDataItems(prev => {
      const updated = [...prev];
      updated[rowIndex] = { ...updated[rowIndex], [field]: value };
      return updated;
    });
  };

  const navigableColumnIndexes = activeFields.reduce((indexes, field, columnIndex) => {
    if (field.type !== 'file' && field.type !== 'image' && !isUsdCostTemplateField(field)) {
      indexes.push(columnIndex);
    }
    return indexes;
  }, []);

  const focusGridCell = (rowIndex, columnIndex) => {
    const input = document.querySelector(
      `[data-grid-row="${rowIndex}"][data-grid-column="${columnIndex}"]`
    );
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  };

  const handleGridKeyDown = (event, rowIndex, columnIndex) => {
    const target = getGridNavigationTarget({
      key: event.key,
      rowIndex,
      columnIndex,
      rowCount: dataItems.length,
      navigableColumns: navigableColumnIndexes
    });
    if (!target) return;

    event.preventDefault();
    if (target.appendRow) {
      if (event.repeat) return;
      setDataItems(prev => [...prev, { ...DEFAULT_ITEM }]);
    }

    setTimeout(() => focusGridCell(target.rowIndex, target.columnIndex), 0);
  };

  const handleGridPaste = (event, rowIndex, columnIndex) => {
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.includes('\t') && !text.includes('\n') && !text.includes('\r')) return;
    const grid = parseClipboardGrid(text);
    const result = applyGridPaste({
      items: dataItems,
      fields: activeFields,
      navigableColumns: navigableColumnIndexes,
      startRow: rowIndex,
      startColumn: columnIndex,
      grid,
      createItem: () => ({ ...DEFAULT_ITEM })
    });
    if (!result || result.pastedCells === 0) return;

    event.preventDefault();
    setDataItems(result.items);
    setTimeout(() => focusGridCell(result.lastRow, result.lastColumn), 0);
    showToast(`已粘贴 ${result.pastedRows} 行 × ${result.pastedColumns} 列`);
  };

  const handleSelectAttachment = async (rowIndex, field) => {
    try {
      const result = await window.electronAPI.attachments.select({ kind: field.type });
      if (result?.canceled || !result?.file) return;
      handleInputChange(rowIndex, field.key, result.file);
    } catch (error) {
      showToast('选择附件失败: ' + error.message, 'error');
    }
  };

  const handleRemoveAttachment = (rowIndex, fieldKey) => {
    handleInputChange(rowIndex, fieldKey, '');
  };

  const addRow = () => setDataItems(prev => [...prev, { ...DEFAULT_ITEM }]);
  const removeRow = (rowIndex) => {
    if (dataItems.length <= 1) return;
    setDataItems(prev => prev.filter((_, i) => i !== rowIndex));
  };
  const clearCurrent = () => {
    setDataItems([{ ...DEFAULT_ITEM }]);
    setCategory('');
    setEditingBatchId(null);
  };

  const handleOpenExisting = async () => {
    setIsOpeningExisting(true);
    try {
      const result = await window.electronAPI.excel.openExisting({
        templateId: selectedTemplate?.id || null
      });
      if (result.canceled) return;
      if (!result.success) {
        showToast(result.message || '读取已有表格失败', 'error');
        return;
      }
      const matchedTemplate = templates.find(template => template.id === result.templateId);
      if (!matchedTemplate) {
        showToast('没有找到生成该表格时使用的模板', 'error');
        return;
      }
      const loadedBatches = result.batches.map(batch => ({
        ...batch,
        items: batch.items.map(item => ({
          ...DEFAULT_ITEM,
          ...item,
          price: item.price || item.totalPrice || '',
          quantity: item.quantity || '1'
        }))
      }));
      if (matchedTemplate.id !== selectedTemplate?.id) {
        suppressDraftRestoreRef.current = true;
      }
      onTemplateSelect(matchedTemplate);
      setBatches(loadedBatches);
      setDataItems([{ ...DEFAULT_ITEM }]);
      setCategory('');
      setEditingBatchId(null);
      setSaveFolder(result.sourceFolder || saveFolder);
      setFileName(result.suggestedFileName || fileName);
      if (result.options?.exchangeRate) setExchangeRate(String(result.options.exchangeRate));
      if (result.options?.invoiceType) setInvoiceType(result.options.invoiceType);
      setLoadedSource({ path: result.sourcePath, exact: result.exact });
      showToast(`已载入 ${loadedBatches.reduce((sum, batch) => sum + batch.items.length, 0)} 行，可继续编辑`);
    } catch (error) {
      showToast('读取已有表格失败: ' + error.message, 'error');
    } finally {
      setIsOpeningExisting(false);
    }
  };

  // ---------- 批次操作 ----------
  const addToBatch = () => {
    const filled = dataItems.filter(itemHasData);
    if (filled.length === 0) {
      showToast('请至少填写一行数据后再添加', 'warning');
      return;
    }

    const batchCategory = category.trim() || '无分类';
    if (editingBatchId !== null) {
      setBatches(prev => prev.map(batch => batch.id === editingBatchId
        ? { ...batch, category: batchCategory, items: filled }
        : batch));
    } else {
      setBatches(prev => [...prev, { id: Date.now(), category: batchCategory, items: filled }]);
    }
    setDataItems([{ ...DEFAULT_ITEM }]);
    setCategory('');
    setEditingBatchId(null);
    showToast(editingBatchId !== null
      ? `已更新「${batchCategory}」共 ${filled.length} 行`
      : `已添加「${batchCategory}」共 ${filled.length} 行到批次列表`);
  };

  const editBatch = (batch) => {
    const hasCurrentData = dataItems.some(itemHasData);
    if (hasCurrentData && editingBatchId !== batch.id && !confirm('当前录入区有未保存内容，继续会替换这些内容。确定编辑该批次吗？')) return;
    setEditingBatchId(batch.id);
    setCategory(batch.category === '无分类' ? '' : batch.category);
    setDataItems(batch.items.map(item => ({ ...DEFAULT_ITEM, ...item, quantity: item.quantity || '1' })));
    showToast(`正在编辑「${batch.category}」`);
  };

  const removeBatch = (batchId) => {
    setBatches(prev => prev.filter(b => b.id !== batchId));
    if (editingBatchId === batchId) clearCurrent();
  };

  const clearAllBatches = () => {
    draftReadyRef.current = false;
    setBatches([]);
    setCategory('');
    setDataItems([{ ...DEFAULT_ITEM }]);
    setEditingBatchId(null);
    setLoadedSource(null);
    if (selectedTemplate?.id) window.electronAPI.draft.delete(selectedTemplate.id);
    setDraftStatus('');
    setTimeout(() => { draftReadyRef.current = true; }, 0);
  };

  // ---------- 生成 ----------
  const handleGenerate = async () => {
    if (!selectedTemplate) { showToast('请先选择一个模板', 'warning'); return; }
    if (!saveFolder) { showToast('请选择保存文件夹', 'warning'); return; }

    // 如果有未添加到批次的当前数据，自动添加
    let allBatches = [...batches];
    const currentFilled = dataItems.filter(itemHasData);
    if (currentFilled.length > 0) {
      const currentCategory = category.trim() || '无分类';
      if (editingBatchId !== null) {
        allBatches = allBatches.map(batch => batch.id === editingBatchId
          ? { ...batch, category: currentCategory, items: currentFilled }
          : batch);
      } else {
        allBatches = [...allBatches, { id: Date.now(), category: currentCategory, items: currentFilled }];
      }
    }

    if (allBatches.length === 0) {
      showToast('请至少填写一行数据或添加一个批次', 'warning');
      return;
    }

    const finalFileName = fileName.trim() || `生成表格_${new Date().toISOString().slice(0, 10)}.xlsx`;
    const savePath = `${saveFolder}\\${finalFileName}`;

    setIsGenerating(true);
    try {
      const result = await window.electronAPI.excel.generate({
        templateId: selectedTemplate.id,
        batches: allBatches,
        savePath: savePath,
        options: {
          autoQuoteNumber: true,
          exchangeRate: parseFloat(exchangeRate) || 7.25,
          invoiceType: invoiceType
        }
      });

      if (result.success) {
        showToast(`文件已保存到: ${result.filePath}`);

        const flatItems = allBatches.flatMap(b => b.items);
        await window.electronAPI.history.add({
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          dataSummary: allBatches.map(b => `${b.category}(${b.items.length}项)`).join(' | '),
          filePath: result.filePath
        });

        // 同时保存为“供应商询价记录”，供内测版的客户询价单回填页面选择。
        await window.electronAPI.rfq.saveQuoteSet({
          name: `${selectedTemplate.name} - ${new Date().toLocaleString('zh-CN')}`,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          batches: allBatches,
          fieldLabels: Object.fromEntries(activeFields.map(field => [field.key, field.label])),
          options: {
            exchangeRate: parseFloat(exchangeRate) || 7.25,
            invoiceType
          },
          generatedFile: result.filePath
        });

        for (const item of flatItems) {
          if (itemHasData(item)) {
            await window.electronAPI.data.saveEntry({ type: 'product', data: item });
          }
        }

        // 生成成功后清空，并删除已经完成的草稿。
        draftReadyRef.current = false;
        setBatches([]);
        setCategory('');
        setDataItems([{ ...DEFAULT_ITEM }]);
        setEditingBatchId(null);
        setLoadedSource(null);
        await window.electronAPI.draft.delete(selectedTemplate.id);
        setDraftStatus('');
        setTimeout(() => { draftReadyRef.current = true; }, 0);
      } else {
        showToast(result.message || '生成失败', 'error');
      }
    } catch (e) {
      showToast('生成失败: ' + e.message, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // ---------- 汇总 ----------
  const allBatchesData = useMemo(() => {
    const all = [...batches];
    const currentFilled = dataItems.filter(itemHasData);
    if (currentFilled.length > 0) {
      if (editingBatchId !== null) {
        const batchIndex = all.findIndex(batch => batch.id === editingBatchId);
        if (batchIndex >= 0) {
          all[batchIndex] = { ...all[batchIndex], category: category.trim() || '无分类', items: currentFilled };
        }
      } else {
        all.push({ id: 'current', category: category.trim() || '无分类', items: currentFilled });
      }
    }
    const flat = all.flatMap(b => b.items);
    const totalPrice = flat.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseFloat(i.quantity) || 1), 0);
    const totalCost = flat.reduce((s, i) => s + (parseFloat(i.cost) || 0) * (parseFloat(i.quantity) || 1), 0);
    const totalProfit = totalPrice - totalCost;
    const profitRate = totalPrice > 0 ? ((totalProfit / totalPrice) * 100).toFixed(2) : '0.00';

    // 美元价格计算
    const rate = parseFloat(exchangeRate) || 7.25;
    const taxDivisor = invoiceType === 'special' ? 1.13 : 1;
    const totalPriceUSD = totalPrice / rate / taxDivisor;
    const totalCostUSD = totalCost / rate / taxDivisor;

    return { batches: all, count: flat.length, totalPrice, totalCost, totalProfit, profitRate,
      rate, taxDivisor, totalPriceUSD, totalCostUSD, invoiceType };
  }, [batches, dataItems, category, editingBatchId, activeFields, exchangeRate, invoiceType]);

  return (
    <div>
      {/* 模板选择 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">选择模板</h2>
          <button className="btn btn-success" onClick={handleOpenExisting} disabled={isOpeningExisting}>
            {isOpeningExisting ? '读取中...' : '📂 继续编辑已有表格'}
          </button>
        </div>
        {loadedSource && (
          <div style={{ padding: '10px 14px', marginBottom: 14, background: '#EAF7EF', border: '1px solid #B8E0C8', borderRadius: 6 }}>
            <div style={{ fontWeight: 600, color: '#1E7E46' }}>已载入已有表格</div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>{loadedSource.path}</div>
            {!loadedSource.exact && (
              <div className="text-sm" style={{ color: '#B36B00', marginTop: 4 }}>
                这是旧版文件，数据由表格内容识别；生成前请检查批次和行数。
              </div>
            )}
          </div>
        )}
        {templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📁</div>
            <div className="empty-state-text">暂无模板</div>
            <div className="empty-state-desc">请先在「模板管理」中导入或创建模板</div>
          </div>
        ) : (
          <div className="template-grid">
            {templates.map(tpl => (
              <div
                key={tpl.id}
                className={`template-card ${selectedTemplate?.id === tpl.id ? 'selected' : ''}`}
                onClick={() => onTemplateSelect(tpl)}
              >
                <div className="template-card-header">
                  <div className="template-card-icon">
                    {tpl.type === '询价表' ? '📋' :
                     tpl.type === '报价表' ? '💰' :
                     tpl.type === '供应商对比表' ? '📊' :
                     tpl.type === '客户报价单' ? '📝' : '📄'}
                  </div>
                  <div>
                    <div className="template-card-name">{tpl.name}</div>
                  </div>
                </div>
                <div className="template-card-type">{tpl.type}</div>
                {tpl.description && <div className="template-card-desc">{tpl.description}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 汇率与发票设置 */}
      <div className="card" style={{ padding: '16px 24px' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div className="flex-center gap-12">
            <span style={{ fontWeight: 600, fontSize: '14px' }}>设置</span>
            <div className="flex-center gap-8">
              <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>当日汇率</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                value={exchangeRate}
                onChange={e => setExchangeRate(e.target.value)}
                style={{ width: '90px' }}
              />
              <button
                className="btn btn-outline btn-sm"
                onClick={() => refreshTodayRate(true, true)}
                disabled={isFetchingRate}
                title="从每日参考汇率服务更新 USD/CNY"
              >
                {isFetchingRate ? '更新中...' : '今日汇率'}
              </button>
              <span className="text-sm text-muted">CNY/USD</span>
              {exchangeRateInfo?.referenceDate && (
                <span className="text-sm text-muted" title={exchangeRateInfo.source || ''}>
                  参考日 {exchangeRateInfo.referenceDate}
                </span>
              )}
            </div>
          </div>
          <div className="flex-center gap-8">
            <span className="form-label" style={{ marginBottom: 0 }}>发票类型</span>
            <div className="flex-center gap-8">
              <label className={`invoice-type-btn ${invoiceType === 'special' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="invoiceType"
                  value="special"
                  checked={invoiceType === 'special'}
                  onChange={() => setInvoiceType('special')}
                  style={{ display: 'none' }}
                />
                专票 (÷1.13)
              </label>
              <label className={`invoice-type-btn ${invoiceType === 'regular' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="invoiceType"
                  value="regular"
                  checked={invoiceType === 'regular'}
                  onChange={() => setInvoiceType('regular')}
                  style={{ display: 'none' }}
                />
                普票
              </label>
            </div>
          </div>
          {allBatchesData.count > 0 && (
            <div className="flex-center gap-8" style={{ marginLeft: 'auto' }}>
              <span className="text-sm text-muted">换算:</span>
              <span style={{ fontWeight: 600, color: 'var(--primary)', fontSize: '14px' }}>
                ${allBatchesData.totalPriceUSD.toFixed(2)}
              </span>
              <span className="text-sm text-muted">
                ({allBatchesData.invoiceType === 'special' ? '含税 ÷1.13' : '不含税'})
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 品类 / 批次标题 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">数据录入</h2>
          <div className="flex-center gap-8">
            <button className="btn btn-outline btn-sm" onClick={addRow} disabled={activeFields.length === 0}>+ 添加行</button>
            <button className="btn btn-outline btn-sm" onClick={clearCurrent}>清空当前</button>
            <span className="text-sm text-muted">当前 {dataItems.length} 行</span>
            {draftStatus && <span className="text-sm text-muted">{draftStatus}</span>}
          </div>
        </div>

        {/* 品类输入 */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: '0 0 260px', marginBottom: 0 }}>
            <label className="form-label">品类 / 大类（可选，自由输入）</label>
            <input
              className="form-input"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="例如：处理器、主板、内存... 不填则为「无分类」"
            />
          </div>
          <button className="btn btn-success" onClick={addToBatch}>
            {editingBatchId !== null ? '保存批次修改' : '+ 添加到批次列表'}
          </button>
          {editingBatchId !== null && (
            <button className="btn btn-outline" onClick={clearCurrent}>取消编辑</button>
          )}
        </div>

        {/* 数据表格 */}
        {isLoadingFields ? (
          <div className="empty-state" style={{ padding: '24px' }}>正在读取模板表头...</div>
        ) : activeFields.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <div className="empty-state-icon">🔗</div>
            <div className="empty-state-text">当前模板没有已映射字段</div>
            <div className="empty-state-desc">请先到「字段映射」中配置模板字段，录入区只显示模板中已映射的表头。</div>
          </div>
        ) : <div className="table-container">
          <table className="data-table data-entry-table">
            <thead>
              <tr>
                <th style={{ width: '28px' }}>#</th>
                {activeFields.map(field => (
                  <th key={field.id} style={{ width: field.width, minWidth: field.width }}>
                    {field.label}
                  </th>
                ))}
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {dataItems.map((item, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="row-number">{rowIndex + 1}</td>
                  {activeFields.map((field, columnIndex) => (
                    <td
                      key={field.id}
                      className="editable-cell"
                      onClick={e => field.type !== 'file' && field.type !== 'image' && e.currentTarget.querySelector('input')?.focus()}
                    >
                      {field.type === 'file' || field.type === 'image' ? (
                        <div className="attachment-cell">
                          {item[field.key]?.name ? (
                            <>
                              <span
                                className={`attachment-file ${field.type === 'image' ? 'attachment-image' : ''}`}
                                title={item[field.key].path || item[field.key].relativePath || item[field.key].name}
                              >
                                {field.type === 'image' ? '🖼️' : '📎'} {item[field.key].name}
                              </span>
                              <button
                                className="attachment-remove"
                                onClick={() => handleRemoveAttachment(rowIndex, field.key)}
                                title="移除附件"
                              >
                                ×
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-outline btn-sm attachment-select"
                              onClick={() => handleSelectAttachment(rowIndex, field)}
                            >
                              {field.type === 'image' ? '选择图片' : '选择附件'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <input
                          className="data-cell-input"
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={getFieldDisplayValue(item, field)}
                          onChange={e => !isUsdCostTemplateField(field) && handleInputChange(rowIndex, field.key, e.target.value)}
                          placeholder={isUsdCostTemplateField(field) ? '自动计算' : `请输入${field.label}`}
                          step={field.type === 'number' ? '0.01' : undefined}
                          aria-label={`第 ${rowIndex + 1} 行 ${field.label}`}
                          data-grid-row={rowIndex}
                          data-grid-column={columnIndex}
                          onKeyDown={event => handleGridKeyDown(event, rowIndex, columnIndex)}
                          onPaste={event => handleGridPaste(event, rowIndex, columnIndex)}
                          readOnly={isUsdCostTemplateField(field)}
                          title={isUsdCostTemplateField(field)
                            ? (invoiceType === 'special' ? '总价 ÷ 今日汇率 ÷ 1.13' : '总价 ÷ 今日汇率')
                            : undefined}
                          style={isUsdCostTemplateField(field) ? { background: '#F3F5F8', color: '#2E7D32', fontWeight: 600 } : undefined}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    {dataItems.length > 1 && (
                      <button className="btn btn-danger btn-sm" onClick={() => removeRow(rowIndex)} title="删除行">✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>

      {/* 批次列表 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            批次列表
            {batches.length > 0 && <span className="badge badge-primary" style={{ marginLeft: 8 }}>{batches.length} 批</span>}
          </h2>
          {batches.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={clearAllBatches}>清空全部</button>
          )}
        </div>

        {batches.length === 0 && dataItems.filter(itemHasData).length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <div className="empty-state-icon">📦</div>
            <div className="empty-state-text">暂无批次</div>
            <div className="empty-state-desc">填写数据后点击「添加批次」将当前内容添加到此处</div>
          </div>
        ) : (
          <div>
            {batches.map((batch, bi) => (
              <div key={batch.id} className="batch-card">
                <div className="batch-card-header">
                  <span className="batch-category-tag">{batch.category}</span>
                  <span className="text-sm text-muted">{batch.items.length} 行数据</span>
                  <div className="flex-center gap-8" style={{ marginLeft: 'auto' }}>
                    <span className="text-sm text-muted">
                      ¥{batch.items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseFloat(i.quantity) || 1), 0).toFixed(2)}
                    </span>
                    <button className="btn btn-outline btn-sm" onClick={() => editBatch(batch)}>编辑</button>
                    <button className="btn btn-danger btn-sm" onClick={() => removeBatch(batch.id)}>删除</button>
                  </div>
                </div>
                <div className="batch-card-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '28px' }}>#</th>
                        {activeFields.map(field => (
                          <th key={field.id} style={{ width: field.width }}>{field.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batch.items.map((item, ri) => (
                        <tr key={ri}>
                          <td className="row-number">{ri + 1}</td>
                          {activeFields.map(field => (
                            <td key={field.id} style={{ fontSize: '12px' }}>
                              {(field.type === 'file' || field.type === 'image')
                                ? (item[field.key]?.name || '-')
                                : (getFieldDisplayValue(item, field) || '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {/* 当前未添加的数据预览 */}
            {(() => {
              const currentFilled = dataItems.filter(itemHasData);
              if (batches.length > 0 && currentFilled.length > 0) {
                return (
                  <div className="batch-card" style={{ borderStyle: 'dashed', opacity: 0.8 }}>
                    <div className="batch-card-header">
                      <span className="batch-category-tag" style={{ background: '#FFF3CD', color: '#856404' }}>
                        {category.trim() || '无分类'}
                      </span>
                      <span className="text-sm text-muted">{currentFilled.length} 行（未保存）</span>
                    </div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}
      </div>

      {/* 汇总 */}
      {allBatchesData.count > 0 && (
        <div className="summary-bar">
          <div className="summary-item">
            <span className="summary-label">总批次数:</span>
            <span className="summary-value">{allBatchesData.batches.length}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">总条目:</span>
            <span className="summary-value">{allBatchesData.count}</span>
          </div>
        </div>
      )}

      {/* 存储位置 */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">存储位置</h2>
        </div>
        <div className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 3 }}>
            <label className="form-label">保存文件夹</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="form-input" value={saveFolder} onChange={e => setSaveFolder(e.target.value)} placeholder="选择或输入保存路径..." style={{ flex: 1 }} />
              <button className="btn btn-outline" onClick={handleSelectFolder}>浏览</button>
              <button className="btn btn-outline" onClick={() => setShowNewFolderInput(!showNewFolderInput)}>+ 新建</button>
            </div>
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">文件名</label>
            <input className="form-input" value={fileName} onChange={e => setFileName(e.target.value)} placeholder="生成表格_2026-07-20.xlsx" />
          </div>
        </div>
        {showNewFolderInput && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">新文件夹名称</label>
              <input className="form-input" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} placeholder="输入新文件夹名称" onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleCreateFolder}>创建</button>
            <button className="btn btn-outline btn-sm" onClick={() => setShowNewFolderInput(false)}>取消</button>
          </div>
        )}
      </div>

      {/* 生成按钮 */}
      <div className="generate-area">
        <button
          className="btn btn-primary btn-lg"
          onClick={handleGenerate}
          disabled={isGenerating || !selectedTemplate}
        >
          {isGenerating ? '生成中...' : '一键生成 Excel'}
        </button>
        {batches.length > 0 && (
          <span className="text-sm text-muted">
            将生成 {batches.length} 个批次共 {allBatchesData.count} 条数据
          </span>
        )}
      </div>
    </div>
  );
}
