const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { MAX_SCAN_ROWS, getEffectiveColumnCount, forEachEffectiveCell } = require('./workbookUtils');

const EDIT_DATA_SHEET = '__ETG_EDIT_DATA__';
const EDIT_DATA_MARKER = 'ETG_EDIT_DATA_V1';
const EDIT_DATA_CHUNK_SIZE = 30000;

class ExcelEngine {
  constructor(db, templateManager) {
    this.db = db;
    this.templateManager = templateManager;
  }

  async generate(templateId, batches, outputPath, options = {}) {
    const template = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) throw new Error('模板不存在');
    if (!Array.isArray(batches) || batches.length === 0) throw new Error('没有可生成的数据');
    const preparedBatches = await this._prepareAttachmentBatches(batches, outputPath);

    const mappings = this.db.prepare('SELECT * FROM field_mappings WHERE template_id = ?').all(templateId);
    const mappingMap = {};
    for (const m of mappings) {
      mappingMap[m.template_field] = m.system_field;
    }
    let customFieldTypes = {};
    try {
      customFieldTypes = Object.fromEntries(
        this.db.prepare('SELECT key, data_type FROM custom_system_fields').all()
          .map(field => [field.key, field.data_type])
      );
    } catch (error) {
      // 兼容尚未创建自定义字段表的旧测试数据库。
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(template.file_path);
    const worksheet = workbook.worksheets[0];

    // 字体基础行高：字号 * 1.8（适合中文显示）
    const BASE_FONT_SIZE = 10;
    const ROW_HEIGHT = Math.round(BASE_FONT_SIZE * 1.8);

    // 获取字段位置映射
    const headerRowNum = Number(options.headerRow) || this._detectHeaderRow(worksheet, mappingMap);
    const fieldPositions = this._getFieldPositions(worksheet, headerRowNum, mappingMap);
    if (Object.keys(fieldPositions).length === 0) {
      throw new Error('模板表头与字段映射不匹配，请先配置字段映射');
    }
    const mappedColumns = Object.keys(fieldPositions).map(Number);
    const colCount = Math.max(getEffectiveColumnCount(worksheet), ...mappedColumns);

    // 从模板获取表头样式作为参考
    const headerStyleRef = this._getHeaderStyleRef(worksheet, headerRowNum);
    this._normalizeGeneratedHeaderRow(worksheet, headerRowNum, colCount);
    const headerTemplate = this._captureRowTemplate(worksheet, headerRowNum, colCount);

    const dataStartRow = Number(options.dataStartRow) || headerRowNum + 1;
    const hasCategories = batches.some(b => b.category && b.category !== '无分类');
    const generatedRowCount = preparedBatches.reduce((count, batch) => {
      const items = Array.isArray(batch.items) ? batch.items : [];
      const categoryRows = hasCategories && batch.category && batch.category !== '无分类' && items.length > 0 ? 1 : 0;
      const repeatedHeaderRows = hasCategories && items.length > 0 ? 1 : 0;
      return count + items.length + categoryRows + repeatedHeaderRows;
    }, 0);
    if (generatedRowCount === 0) throw new Error('没有可生成的数据');

    // 有大类时，每个区块按“大类行 → 表头行 → 数据行”输出。
    // 复用原表头所在行作为第一个生成行，让表头上方标题和下方页尾都得到保留。
    if (hasCategories) {
      const rowsToInsert = Math.max(generatedRowCount - 1, 0);
      if (rowsToInsert > 0) {
        worksheet.insertRows(
          headerRowNum + 1,
          Array.from({ length: rowsToInsert }, () => []),
          'i'
        );
      }
    } else {
      worksheet.insertRows(
        dataStartRow,
        Array.from({ length: generatedRowCount }, () => []),
        'i'
      );
    }

    let currentRow = hasCategories ? headerRowNum : dataStartRow;

    for (let bi = 0; bi < preparedBatches.length; bi++) {
      const batch = preparedBatches[bi];
      const items = batch.items || [];
      if (items.length === 0) continue;

      // 如果有品类分类，先写分类标题行
      if (hasCategories && batch.category && batch.category !== '无分类') {
        this._writeCategoryRow(worksheet, currentRow, colCount, batch.category);
        currentRow++;
      }

      // 每个大类后都紧接一行完整表头。
      if (hasCategories) {
        this._applyRowTemplate(worksheet, currentRow, headerTemplate);
        currentRow++;
      }

      // 填充该批次的数据行
      for (let i = 0; i < items.length; i++) {
        const dataItem = { ...items[i] };
        const targetRow = worksheet.getRow(currentRow);
        targetRow.height = ROW_HEIGHT;

        // 自动计算
        const price = parseFloat(dataItem.price) || 0;
        const cost = parseFloat(dataItem.cost) || 0;
        const quantity = parseFloat(dataItem.quantity) || 1;
        dataItem.profit = (price - cost).toFixed(2);
        dataItem.profitRate = price > 0 ? ((dataItem.profit / price) * 100).toFixed(2) + '%' : '0%';
        dataItem.totalPrice = (price * quantity).toFixed(2);

        // 美元价格计算：总价 / 汇率 / (专票÷1.13)
        const exRate = parseFloat(options.exchangeRate) || 7.25;
        const taxDiv = (options.invoiceType === 'special') ? 1.13 : 1;
        const totalRMB = price * quantity;
        dataItem.usdPrice = (price / exRate / taxDiv).toFixed(2);
        dataItem.usdTotalPrice = (totalRMB / exRate / taxDiv).toFixed(2);
        // “美金成本”按含税含运总价换算：专票再除以 1.13，普票不除税率。
        dataItem.usdCost = (price / exRate / taxDiv).toFixed(2);

        // 填充每个字段
        for (const [colNum, systemField] of Object.entries(fieldPositions)) {
          const col = parseInt(colNum);
          const cell = targetRow.getCell(col);
          const value = this._getDataValue(dataItem, systemField);

          // 应用样式
          this._applyDataCellStyle(cell, systemField, headerStyleRef);

          // 设置值
          if (this._isAttachmentValue(value)) {
            this._writeAttachmentCell(workbook, worksheet, cell, value, outputPath, currentRow, col);
            if (value.kind === 'image') targetRow.height = Math.max(targetRow.height || ROW_HEIGHT, 62);
          } else if (value !== undefined && value !== null && value !== '') {
            if (['price', 'cost', 'totalPrice', 'profit', 'usdPrice', 'usdTotalPrice', 'usdCost'].includes(systemField)) {
              cell.value = parseFloat(value) || 0;
              if (['usdPrice', 'usdTotalPrice', 'usdCost'].includes(systemField)) {
                cell.numFmt = options.usdCurrencyFormat || '$#,##0.00;[Red]-$#,##0.00';
              } else {
                cell.numFmt = options.currencyFormat || '#,##0.00';
              }
            } else if (systemField === 'profitRate') {
              const rateVal = parseFloat(value) || 0;
              cell.value = rateVal / 100;
              cell.numFmt = '0.00%';
            } else if (systemField === 'date') {
              cell.value = value;
              cell.numFmt = 'yyyy-mm-dd';
            } else if (customFieldTypes[systemField] === 'number') {
              cell.value = parseFloat(value) || 0;
              cell.numFmt = '#,##0.00';
            } else {
              cell.value = value;
            }
          }
        }

        targetRow.commit();
        currentRow++;
      }
    }

    // 自动调整列宽（根据内容）
    this._autoFitColumns(worksheet, colCount, headerRowNum, currentRow - 1);

    // 自动生成报价编号
    if (options.autoQuoteNumber !== false) {
      this._generateQuoteNumber(worksheet, options, colCount);
    }

    // 设置打印区域
    worksheet.pageSetup = {
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      paperSize: 9, // A4
      ...(options.pageSetup || {})
    };

    // 保存一份隐藏的可编辑数据，使本程序生成的文件可以无损重新打开继续编辑。
    this._writeEditMetadata(workbook, {
      version: 1,
      templateId,
      batches: preparedBatches,
      options: {
        exchangeRate: options.exchangeRate,
        invoiceType: options.invoiceType
      }
    });

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  }

  async readExisting(filePath, preferredTemplateId = null) {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('所选 Excel 文件不存在');
    if (path.extname(filePath).toLowerCase() !== '.xlsx') throw new Error('仅支持 .xlsx 格式');
    if (fs.statSync(filePath).size > 100 * 1024 * 1024) throw new Error('文件超过 100MB，无法安全载入');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const metadata = this._readEditMetadata(workbook);
    if (metadata?.templateId && Array.isArray(metadata.batches)) {
      const template = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(metadata.templateId);
      if (!template) throw new Error('该表格使用的原模板已被删除，请重新导入或创建原模板');
      const restoredBatches = this._restoreAttachmentPaths(metadata.batches, path.dirname(filePath));
      return this._buildExistingResult(filePath, template, restoredBatches, metadata.options || {}, true);
    }

    if (!preferredTemplateId) {
      throw new Error('这是旧版生成的表格，请先在页面上选择它原来使用的模板，再重新打开');
    }
    const template = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(preferredTemplateId);
    if (!template) throw new Error('所选模板不存在');
    const mappings = this.db.prepare('SELECT * FROM field_mappings WHERE template_id = ?').all(preferredTemplateId);
    if (!mappings.length) throw new Error('所选模板还没有字段映射，无法识别已有表格');

    const worksheet = workbook.worksheets.find(sheet => sheet.name !== EDIT_DATA_SHEET);
    if (!worksheet) throw new Error('Excel 文件中没有可读取的工作表');
    const mappingMap = Object.fromEntries(mappings.map(item => [item.template_field, item.system_field]));
    const parsedBatches = this._parseGeneratedWorksheet(worksheet, mappingMap);
    if (!parsedBatches.length) throw new Error('未识别到可编辑数据，请确认选择了生成此表格时使用的模板');
    return this._buildExistingResult(filePath, template, parsedBatches, {}, false);
  }

  _writeEditMetadata(workbook, metadata) {
    const existing = workbook.getWorksheet(EDIT_DATA_SHEET);
    if (existing) workbook.removeWorksheet(existing.id);
    const sheet = workbook.addWorksheet(EDIT_DATA_SHEET, { state: 'veryHidden' });
    sheet.state = 'veryHidden';
    const json = JSON.stringify(metadata);
    const chunks = [];
    for (let index = 0; index < json.length; index += EDIT_DATA_CHUNK_SIZE) {
      chunks.push(json.slice(index, index + EDIT_DATA_CHUNK_SIZE));
    }
    sheet.getCell('A1').value = EDIT_DATA_MARKER;
    sheet.getCell('A2').value = chunks.length;
    chunks.forEach((chunk, index) => { sheet.getCell(index + 3, 1).value = chunk; });
  }

  _readEditMetadata(workbook) {
    const sheet = workbook.getWorksheet(EDIT_DATA_SHEET);
    if (!sheet || sheet.getCell('A1').value !== EDIT_DATA_MARKER) return null;
    const chunkCount = Math.min(Math.max(Number(sheet.getCell('A2').value) || 0, 0), 10000);
    if (chunkCount === 0) return null;
    let json = '';
    for (let index = 0; index < chunkCount; index++) {
      json += String(sheet.getCell(index + 3, 1).value || '');
      if (json.length > 20 * 1024 * 1024) throw new Error('表格中的编辑数据过大');
    }
    try {
      return JSON.parse(json);
    } catch (error) {
      throw new Error('表格中的可编辑数据已损坏');
    }
  }

  _buildExistingResult(filePath, template, batches, options, exact) {
    const safeBatches = batches
      .map((batch, index) => ({
        id: `loaded-${Date.now()}-${index}`,
        category: String(batch.category || '无分类'),
        items: Array.isArray(batch.items) ? batch.items.filter(item => item && typeof item === 'object') : []
      }))
      .filter(batch => batch.items.length > 0);
    const extension = path.extname(filePath);
    const baseName = path.basename(filePath, extension);
    return {
      success: true,
      sourcePath: filePath,
      sourceFolder: path.dirname(filePath),
      suggestedFileName: `${baseName}_继续编辑${extension}`,
      templateId: template.id,
      templateName: template.name,
      batches: safeBatches,
      options,
      exact
    };
  }

  _parseGeneratedWorksheet(worksheet, mappingMap) {
    const rowLimit = Math.min(worksheet.rowCount || 1, MAX_SCAN_ROWS);
    let bestMatches = 0;
    let fieldPositions = {};
    const headerRows = [];

    for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber++) {
      const positions = this._getFieldPositions(worksheet, rowNumber, mappingMap);
      const matches = Object.keys(positions).length;
      if (matches > bestMatches) {
        bestMatches = matches;
        fieldPositions = positions;
      }
    }
    if (bestMatches === 0) return [];
    for (let rowNumber = 1; rowNumber <= rowLimit; rowNumber++) {
      if (Object.keys(this._getFieldPositions(worksheet, rowNumber, mappingMap)).length === bestMatches) {
        headerRows.push(rowNumber);
      }
    }

    const mappedColumns = Object.keys(fieldPositions).map(Number);
    const minCol = Math.min(...mappedColumns);
    const maxCol = Math.max(...mappedColumns);
    const headerSet = new Set(headerRows);
    const categoryRows = this._getCategoryRows(worksheet, minCol, maxCol, rowLimit);
    let category = '无分类';
    const firstHeader = headerRows[0];
    if (categoryRows.has(firstHeader - 1) && this._isGeneratedCategoryStyle(worksheet.getCell(firstHeader - 1, minCol))) {
      category = this._cleanCategoryText(worksheet.getCell(firstHeader - 1, minCol).text);
    }

    const batches = [];
    let items = [];
    const flush = () => {
      if (items.length > 0) batches.push({ category, items });
      items = [];
    };

    for (let rowNumber = firstHeader + 1; rowNumber <= rowLimit; rowNumber++) {
      if (headerSet.has(rowNumber)) continue;
      if (categoryRows.has(rowNumber)) {
        flush();
        category = this._cleanCategoryText(worksheet.getCell(rowNumber, minCol).text);
        continue;
      }
      const row = worksheet.getRow(rowNumber);
      const item = {};
      let hasValue = false;
      for (const [columnNumber, systemField] of Object.entries(fieldPositions)) {
        const value = this._cellToEditableValue(row.getCell(Number(columnNumber)));
        if (value !== '') {
          item[systemField] = value;
          hasValue = true;
        }
      }
      if (hasValue) items.push(item);
    }
    flush();
    return batches;
  }

  _getCategoryRows(worksheet, minCol, maxCol, rowLimit) {
    const rows = new Set();
    for (const merge of worksheet.model.merges || []) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(merge);
      if (!match || Number(match[2]) !== Number(match[4])) continue;
      const rowNumber = Number(match[2]);
      if (rowNumber > rowLimit) continue;
      const startCol = this._columnLettersToNumber(match[1]);
      const endCol = this._columnLettersToNumber(match[3]);
      if (startCol <= minCol && endCol >= maxCol && worksheet.getCell(rowNumber, minCol).text.trim()) {
        rows.add(rowNumber);
      }
    }
    return rows;
  }

  _isGeneratedCategoryStyle(cell) {
    const color = cell.fill?.fgColor?.argb || '';
    return color.toUpperCase() === 'FFFFFF00' || cell.text.trim().startsWith('▍');
  }

  _cleanCategoryText(value) {
    return String(value || '').trim().replace(/^▍\s*/, '') || '无分类';
  }

  _columnLettersToNumber(letters) {
    return letters.split('').reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
  }

  _cellToEditableValue(cell) {
    const value = cell.value;
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') {
      if (value.result !== undefined && value.result !== null) return String(value.result);
      if (value.text !== undefined && value.text !== null) return String(value.text);
      return cell.text || '';
    }
    return String(value);
  }

  _isAttachmentValue(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      (value.kind === 'file' || value.kind === 'image') &&
      (value.path || value.relativePath)
    );
  }

  async _prepareAttachmentBatches(batches, outputPath) {
    const outputFolder = path.dirname(outputPath);
    const baseName = path.basename(outputPath, path.extname(outputPath));
    const attachmentFolderName = `${baseName}_附件`;
    const attachmentFolder = path.join(outputFolder, attachmentFolderName);
    let attachmentFolderCreated = false;
    const copiedBatches = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex] || {};
      const copiedItems = [];
      const sourceItems = Array.isArray(batch.items) ? batch.items : [];
      for (let itemIndex = 0; itemIndex < sourceItems.length; itemIndex++) {
        const item = sourceItems[itemIndex] || {};
        const copiedItem = { ...item };
        let attachmentIndex = 0;
        for (const [fieldKey, value] of Object.entries(item)) {
          if (!this._isAttachmentValue(value)) continue;
          const sourcePath = value.path
            ? path.resolve(value.path)
            : path.resolve(outputFolder, String(value.relativePath).replace(/\//g, path.sep));
          if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
            throw new Error(`附件不存在或已被移动：${value.name || sourcePath}`);
          }
          if (!attachmentFolderCreated) {
            await fs.promises.mkdir(attachmentFolder, { recursive: true });
            attachmentFolderCreated = true;
          }
          attachmentIndex++;
          const safeName = this._sanitizeAttachmentName(value.name || path.basename(sourcePath));
          const safeField = this._sanitizeAttachmentName(fieldKey).slice(0, 24) || 'attachment';
          const targetName = [
            String(batchIndex + 1).padStart(3, '0'),
            String(itemIndex + 1).padStart(3, '0'),
            String(attachmentIndex).padStart(2, '0'),
            safeField,
            safeName
          ].join('_');
          const targetPath = path.join(attachmentFolder, targetName);
          if (path.resolve(sourcePath).toLowerCase() !== path.resolve(targetPath).toLowerCase()) {
            await fs.promises.copyFile(sourcePath, targetPath);
          }
          copiedItem[fieldKey] = {
            kind: value.kind,
            name: value.name || path.basename(sourcePath),
            extension: String(value.extension || path.extname(sourcePath).slice(1)).toLowerCase(),
            size: Number(value.size) || fs.statSync(sourcePath).size,
            relativePath: `${attachmentFolderName}/${targetName}`
          };
        }
        copiedItems.push(copiedItem);
      }
      copiedBatches.push({ ...batch, items: copiedItems });
    }
    return copiedBatches;
  }

  _restoreAttachmentPaths(batches, workbookFolder) {
    return batches.map(batch => ({
      ...batch,
      items: (batch.items || []).map(item => {
        const restored = { ...item };
        for (const [fieldKey, value] of Object.entries(item || {})) {
          if (!this._isAttachmentValue(value)) continue;
          restored[fieldKey] = {
            ...value,
            path: value.path || path.resolve(workbookFolder, String(value.relativePath).replace(/\//g, path.sep))
          };
        }
        return restored;
      })
    }));
  }

  _sanitizeAttachmentName(value) {
    const sanitized = String(value || 'attachment')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return sanitized.slice(0, 100) || 'attachment';
  }

  _writeAttachmentCell(workbook, worksheet, cell, attachment, outputPath, rowNumber, colNumber) {
    const relativePath = String(attachment.relativePath || '').replace(/\\/g, '/');
    const absolutePath = attachment.path ||
      path.resolve(path.dirname(outputPath), relativePath.replace(/\//g, path.sep));

    if (attachment.kind === 'image') {
      const extension = String(attachment.extension || path.extname(absolutePath).slice(1)).toLowerCase();
      const excelExtension = extension === 'jpg' ? 'jpeg' : extension;
      if (!['png', 'jpeg', 'gif'].includes(excelExtension)) {
        throw new Error(`Excel 不支持直接显示该图片格式：${attachment.name}`);
      }
      const imageId = workbook.addImage({ filename: absolutePath, extension: excelExtension });
      worksheet.addImage(imageId, {
        tl: { col: colNumber - 1 + 0.08, row: rowNumber - 1 + 0.08 },
        ext: { width: 96, height: 72 },
        editAs: 'oneCell'
      });
      cell.value = attachment.name || '图片';
      cell.font = { name: '宋体', size: 8, color: { argb: 'FF666666' } };
      cell.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };
      return;
    }

    cell.value = {
      text: `打开附件：${attachment.name || path.basename(absolutePath)}`,
      hyperlink: relativePath || `file:///${absolutePath.replace(/\\/g, '/')}`,
      tooltip: '点击打开附件'
    };
    cell.font = { name: '宋体', size: 10, color: { argb: 'FF0563C1' }, underline: true };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  }

  _getFieldPositions(worksheet, headerRow, mappingMap) {
    const positions = {};
    const row = worksheet.getRow(headerRow);
    const effectiveColumnCount = getEffectiveColumnCount(worksheet);
    forEachEffectiveCell(row, effectiveColumnCount, (cell, colNumber) => {
      const cellText = (cell.text || cell.value || '').toString().trim();
      const cleanField = cellText.replace(/\{\{|\}\}/g, '');
      if (this._isLandedPriceHeader(cleanField)) {
        positions[colNumber] = 'price';
      } else if (this._isUsdCostHeader(cleanField)) {
        positions[colNumber] = 'usdCost';
      } else if (mappingMap[cleanField]) {
        positions[colNumber] = mappingMap[cleanField];
      } else if (mappingMap[cellText]) {
        positions[colNumber] = mappingMap[cellText];
      }
    });
    return positions;
  }

  _isUsdCostHeader(value) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[\s/\\()（）【】\[\]：:、,_-]/g, '');
    return normalized.includes('美金成本') ||
      normalized.includes('美元成本') ||
      normalized.includes('usdcost');
  }

  _isLandedPriceHeader(value) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/[\s/\\()（）【】\[\]：:、,_-]/g, '');
    return normalized.includes('含税含运');
  }

  _detectHeaderRow(worksheet, mappingMap) {
    let bestRow = 1;
    let bestMatches = 0;
    const maxRows = Math.min(worksheet.rowCount || 1, 50);
    const effectiveColumnCount = getEffectiveColumnCount(worksheet);
    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
      let matches = 0;
      forEachEffectiveCell(worksheet.getRow(rowNumber), effectiveColumnCount, cell => {
        const text = (cell.text || cell.value || '').toString().trim();
        const clean = text.replace(/\{\{|\}\}/g, '');
        if (mappingMap[clean] || mappingMap[text]) matches++;
      });
      if (matches > bestMatches) {
        bestMatches = matches;
        bestRow = rowNumber;
      }
    }
    return bestRow;
  }

  _getHeaderStyleRef(worksheet, headerRow) {
    const ref = {};
    const row = worksheet.getRow(headerRow);
    const effectiveColumnCount = getEffectiveColumnCount(worksheet);
    forEachEffectiveCell(row, effectiveColumnCount, (cell, colNumber) => {
      ref[colNumber] = {
        font: cell.font ? { ...cell.font } : null,
        fill: cell.fill ? { ...cell.fill } : null,
        alignment: cell.alignment ? { ...cell.alignment } : null,
        border: cell.border ? { ...cell.border } : null
      };
    });
    return ref;
  }

  _captureRowTemplate(worksheet, rowNumber, colCount) {
    const row = worksheet.getRow(rowNumber);
    return {
      height: row.height,
      hidden: row.hidden,
      outlineLevel: row.outlineLevel,
      cells: Array.from({ length: colCount }, (_, index) => {
        const cell = row.getCell(index + 1);
        return {
          value: this._cloneTemplateValue(cell.value),
          style: this._cloneTemplateValue(cell.style)
        };
      })
    };
  }

  _applyRowTemplate(worksheet, rowNumber, template) {
    const row = worksheet.getRow(rowNumber);
    row.height = template.height;
    row.hidden = template.hidden;
    row.outlineLevel = template.outlineLevel;
    template.cells.forEach((source, index) => {
      const cell = row.getCell(index + 1);
      cell.value = this._cloneTemplateValue(source.value);
      cell.style = this._cloneTemplateValue(source.style) || {};
    });
  }

  _normalizeGeneratedHeaderRow(worksheet, rowNumber, colCount) {
    const row = worksheet.getRow(rowNumber);
    for (let col = 1; col <= colCount; col++) {
      const cell = row.getCell(col);
      if (typeof cell.value !== 'string') continue;
      cell.value = cell.value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1');
    }
  }

  _writeCategoryRow(worksheet, rowNumber, colCount, category) {
    const row = worksheet.getRow(rowNumber);
    row.height = 24;
    if (colCount > 1) worksheet.mergeCells(rowNumber, 1, rowNumber, colCount);

    const cell = row.getCell(1);
    cell.value = category;
    cell.font = { name: '微软雅黑', size: 12, bold: false, color: { argb: 'FF000000' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF000000' } },
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
      left: { style: 'thin', color: { argb: 'FF000000' } },
      right: { style: 'thin', color: { argb: 'FF000000' } }
    };
  }

  _cloneTemplateValue(value) {
    if (value === undefined || value === null) return value;
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  _applyDataCellStyle(cell, systemField, headerStyleRef) {
    // 默认数据行样式
    cell.font = { name: '宋体', size: 10, color: { argb: 'FF333333' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
    };

    // 数字字段右对齐
    if (['price', 'cost', 'totalPrice', 'profit', 'profitRate', 'quantity', 'usdPrice', 'usdTotalPrice', 'usdCost'].includes(systemField)) {
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
    // 文本字段左对齐
    if (['supplierName', 'productName', 'afterSales', 'warranty', 'paymentTerms', 'notes'].includes(systemField)) {
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
  }

  _autoFitColumns(worksheet, colCount, headerRow, lastDataRow) {
    const colWidths = {};

    // 保留模板的基础列宽，同时允许较长内容扩展到 45 个字符宽度。
    for (let c = 1; c <= colCount; c++) {
      const col = worksheet.getColumn(c);
      colWidths[c] = Math.max(8, Number(col.width) || 12);
    }

    for (let r = headerRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      for (let col = 1; col <= colCount; col++) {
        const cell = row.getCell(col);
        if (cell.isMerged) continue;
        const lines = String(cell.text || '').split(/\r?\n/);
        const longestLine = Math.max(0, ...lines.map(line => this._getDisplayTextWidth(line)));
        const neededWidth = Math.min(Math.max(longestLine + 2, 8), 45);
        colWidths[col] = Math.max(colWidths[col], neededWidth);
      }
    }

    for (const [col, width] of Object.entries(colWidths)) {
      worksheet.getColumn(Number(col)).width = Math.round(width * 10) / 10;
    }

    // 列宽确定后，再根据换行后的实际行数增加行高，避免长中文被截断。
    for (let r = headerRow; r <= lastDataRow; r++) {
      const row = worksheet.getRow(r);
      let requiredHeight = Number(row.height) || 18;
      let hasUnmergedContent = false;

      for (let col = 1; col <= colCount; col++) {
        const cell = row.getCell(col);
        if (cell.isMerged || !cell.text) continue;
        hasUnmergedContent = true;
        const availableWidth = Math.max((colWidths[col] || 10) - 2, 4);
        const wrappedLines = String(cell.text).split(/\r?\n/).reduce((count, line) => {
          const displayWidth = this._getDisplayTextWidth(line);
          return count + Math.max(1, Math.ceil(displayWidth / availableWidth));
        }, 0);
        const fontSize = Number(cell.font?.size) || 10;
        requiredHeight = Math.max(requiredHeight, wrappedLines * fontSize * 1.5 + 3);
      }

      if (hasUnmergedContent) {
        row.height = Math.min(Math.ceil(requiredHeight), 120);
      }
    }
  }

  _getDisplayTextWidth(value) {
    return Array.from(String(value || '')).reduce((width, character) => {
      // 中文及其他全角字符在 Excel 中大约占两个英文字符宽度。
      return width + (character.charCodeAt(0) > 255 ? 2 : 1);
    }, 0);
  }

  _getDataValue(dataItem, systemField) {
    if (dataItem[systemField] !== undefined) return dataItem[systemField];
    return '';
  }

  _generateQuoteNumber(worksheet, options, colCount) {
    const quotePrefix = options.quotePrefix || 'BJ';
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    const quoteNumber = `${quotePrefix}-${dateStr}-${random}`;

    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      forEachEffectiveCell(row, colCount, cell => {
        const text = (cell.text || cell.value || '').toString();
        if (text.includes('{{报价编号}}') || text.includes('{{quoteNumber}}')) {
          cell.value = quoteNumber;
          cell.font = { name: '宋体', size: 10 };
        }
      });
    }
  }

  // 创建空白模板（带品类标题行）
  async createBlankTemplate(type, name) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    const columns = this._getDefaultColumns(type);

    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;
    columns.forEach((col, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = `{{${col.label}}}`;
      cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      worksheet.getColumn(index + 1).width = col.width || 15;
    });
    headerRow.commit();

    const filePath = path.join(this.templateManager.templatesDir, `${name}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  _getDefaultColumns(type) {
    const typeConfigs = {
      '询价表': [
        { label: '供应商名称', width: 20 }, { label: '产品名称', width: 18 },
        { label: '型号', width: 15 }, { label: '价格', width: 12 },
        { label: '数量', width: 10 }, { label: '交货期', width: 12 },
        { label: '付款方式', width: 12 }, { label: '备注', width: 20 }
      ],
      '报价表': [
        { label: '报价编号', width: 15 }, { label: '产品名称', width: 18 },
        { label: '型号', width: 15 }, { label: '数量', width: 10 },
        { label: '单价', width: 12 }, { label: '总价', width: 12 },
        { label: '成本', width: 12 }, { label: '利润', width: 12 },
        { label: '交货期', width: 12 }, { label: '售后政策', width: 15 }
      ],
      '供应商对比表': [
        { label: '产品名称', width: 15 }, { label: '型号', width: 12 },
        { label: '供应商名称', width: 18 }, { label: '价格', width: 12 },
        { label: '成本', width: 12 }, { label: '利润率', width: 10 },
        { label: '售后政策', width: 15 }, { label: '付款方式', width: 12 },
        { label: '交货期', width: 10 }, { label: '备注', width: 18 }
      ],
      '客户报价单': [
        { label: '报价编号', width: 15 }, { label: '产品名称', width: 18 },
        { label: '型号', width: 15 }, { label: '数量', width: 10 },
        { label: '单价', width: 12 }, { label: '总价', width: 12 },
        { label: '交货期', width: 12 }, { label: '保修期', width: 12 },
        { label: '售后政策', width: 15 }, { label: '备注', width: 18 }
      ]
    };
    return typeConfigs[type] || [
      { label: '供应商名称', width: 18 }, { label: '产品名称', width: 18 },
      { label: '型号', width: 15 }, { label: '价格', width: 12 },
      { label: '成本', width: 12 }, { label: '售后政策', width: 15 },
      { label: '备注', width: 20 }
    ];
  }
}

module.exports = { ExcelEngine };
