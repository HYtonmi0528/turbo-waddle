const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('./database');
const ExcelJS = require('exceljs');
const {
  MAX_TEMPLATE_COLUMNS,
  MAX_SCAN_ROWS,
  getEffectiveColumnCount,
  forEachEffectiveCell
} = require('./workbookUtils');

class TemplateFileManager {
  constructor(templatesDir, databaseProvider = getDatabase) {
    this.templatesDir = templatesDir;
    this.databaseProvider = databaseProvider;
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
  }

  listTemplates() {
    const db = this.databaseProvider();
    return db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all();
  }

  updateTemplateInfo(templateId, input = {}) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) throw new Error('模板不存在');
    const name = String(input.name || '').trim();
    const type = String(input.type || '通用').trim() || '通用';
    const description = String(input.description || '').trim();
    if (!name) throw new Error('请输入模板名称');
    if (name.length > 100) throw new Error('模板名称不能超过 100 个字符');
    if (description.length > 500) throw new Error('模板说明不能超过 500 个字符');
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE templates
      SET name = ?, type = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(name, type, description, updatedAt, templateId);
    return { ...template, name, type, description, updated_at: updatedAt };
  }

  async saveTemplate(templateData) {
    const db = this.databaseProvider();
    const id = templateData.id || uuidv4();
    const now = new Date().toISOString();
    let createdFile = false;
    
    // 保存模板文件
    let filePath = templateData.file_path;
    if (!filePath || templateData.base64Data) {
      const ext = '.xlsx';
      const fileName = `${id}${ext}`;
      filePath = path.join(this.templatesDir, fileName);
      
      if (templateData.base64Data) {
        const buffer = Buffer.from(templateData.base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);
        createdFile = true;
      } else if (templateData.buffer) {
        fs.writeFileSync(filePath, templateData.buffer);
        createdFile = true;
      } else {
        await this._createBlankTemplateFile(
          filePath,
          templateData.type || '通用',
          templateData.fields
        );
        createdFile = true;
      }
    }

    try {
      db.prepare(`
        INSERT OR REPLACE INTO templates (id, name, type, description, file_path, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM templates WHERE id = ?), ?), ?)
      `).run(
        id, templateData.name, templateData.type || '通用',
        templateData.description || '', filePath,
        templateData.isBuiltin ? 1 : 0, id, now, now
      );
    } catch (err) {
      if (createdFile && filePath && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore cleanup failure */ }
      }
      throw err;
    }

    return { id, filePath };
  }

  deleteTemplate(templateId) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return false;

    // 删除模板文件
    if (template.file_path && fs.existsSync(template.file_path)) {
      fs.unlinkSync(template.file_path);
    }

    db.prepare('DELETE FROM templates WHERE id = ?').run(templateId);
    db.prepare('DELETE FROM field_mappings WHERE template_id = ?').run(templateId);
    return true;
  }

  async importTemplate(sourcePath) {
    // 检查文件是否存在
    if (!fs.existsSync(sourcePath)) {
      throw new Error('文件不存在，请重新选择');
    }

    // 检查文件格式：ExcelJS 不支持旧版 .xls 二进制格式
    const ext = path.extname(sourcePath).toLowerCase();
    if (ext === '.xls') {
      throw new Error('不支持旧版 .xls 格式，请先将文件另存为 .xlsx 格式后再导入');
    }

    // 检查文件大小（空文件或无意义文件）
    const stat = fs.statSync(sourcePath);
    if (stat.size === 0) {
      throw new Error('文件为空，无法导入');
    }
    if (stat.size > 50 * 1024 * 1024) {
      throw new Error('文件过大（超过50MB），请精简后再导入');
    }

    const fileName = path.basename(sourcePath, path.extname(sourcePath));
    const id = uuidv4();
    const destPath = path.join(this.templatesDir, `${id}.xlsx`);
    
    // 确保模板目录存在
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }

    // 拷贝文件
    try {
      fs.copyFileSync(sourcePath, destPath);
    } catch (copyErr) {
      throw new Error(`文件拷贝失败：${copyErr.message}。请检查文件是否被其他程序占用。`);
    }

    // 验证拷贝后的文件可用
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(destPath);
    } catch (readErr) {
      // 清理无效文件
      try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
      throw new Error(`无法读取Excel文件：${readErr.message}。请确认文件格式正确且未损坏。`);
    }

    const db = this.databaseProvider();
    const now = new Date().toISOString();
    
    try {
      db.prepare(`
        INSERT INTO templates (id, name, type, description, file_path, is_builtin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(id, fileName, '导入模板', `从 ${fileName} 导入`, destPath, now, now);
    } catch (dbErr) {
      // 数据库写入失败，清理文件
      try { fs.unlinkSync(destPath); } catch (e) { /* ignore */ }
      throw new Error(`模板保存失败：${dbErr.message}`);
    }

    // 自动提取模板中的字段（提取失败不影响导入结果）
    let fields = [];
    try {
      fields = await this.extractTemplateFields(destPath);
    } catch (e) {
      console.error('提取模板字段失败（模板已导入）:', e.message);
    }
    
    return { id, name: fileName, fields };
  }

  async extractTemplateFields(filePath) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return [];

      const fields = new Set();
      const effectiveColumnCount = getEffectiveColumnCount(worksheet);
      const rowCount = Math.min(worksheet.rowCount, MAX_SCAN_ROWS);

      for (let rowNumber = 1; rowNumber <= rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        forEachEffectiveCell(row, effectiveColumnCount, (cell) => {
          try {
            // 获取单元格文本：优先 text，否则 value 转字符串
            let cellText = '';
            if (cell.text && typeof cell.text === 'string') {
              cellText = cell.text;
            } else if (cell.value !== null && cell.value !== undefined) {
              cellText = String(cell.value);
            }
            // 提取 {{字段名}} 中的字段
            // 每次循环新建正则，避免 lastIndex 状态污染
            const matches = cellText.matchAll(/\{\{([^}]+)\}\}/g);
            for (const m of matches) {
              fields.add(m[1].trim());
            }
          } catch (e) { /* 跳过无法读取的单元格 */ }
        });
      }

      return Array.from(fields);
    } catch (err) {
      console.error('提取模板字段失败:', err);
      return [];
    }
  }

  async getTemplateStructure(templateId) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(template.file_path);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return null;

    const effectiveColumnCount = getEffectiveColumnCount(worksheet);
    const headerRowNumber = this._detectHeaderRow(worksheet, effectiveColumnCount);
    const structure = {
      name: template.name,
      headerRow: headerRowNumber,
      columns: [],
      mergedCells: [],
      rowCount: worksheet.rowCount,
      colCount: effectiveColumnCount
    };

    // 提取列信息
    const headerRow = worksheet.getRow(headerRowNumber);
    forEachEffectiveCell(headerRow, effectiveColumnCount, (cell, colNumber) => {
      structure.columns.push({
        colNumber,
        sourceColNumber: colNumber,
        header: cell.text || '',
        width: worksheet.getColumn(colNumber).width || 10,
        style: {
          font: cell.font ? { ...cell.font } : null,
          fill: cell.fill ? { ...cell.fill } : null,
          alignment: cell.alignment ? { ...cell.alignment } : null,
          border: cell.border ? { ...cell.border } : null
        }
      });
    });

    // 合并单元格信息
    if (worksheet.model && worksheet.model.merges) {
      structure.mergedCells = worksheet.model.merges;
    }

    return structure;
  }

  async updateTemplateStructure(templateId, structure) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return false;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(template.file_path);
    const worksheet = workbook.worksheets[0];
    if (!worksheet || !structure || !Array.isArray(structure.columns)) return false;
    if (worksheet.columnCount > MAX_TEMPLATE_COLUMNS) {
      throw new Error('模板包含跨越整张工作表的异常合并区域；字段映射和生成可正常使用，但请先在原 Excel 中取消整行合并后再编辑列结构');
    }

    const headerRow = Number(structure.headerRow) || 1;
    const oldColumnCount = worksheet.columnCount;
    const oldRowCount = worksheet.rowCount;
    const columns = structure.columns.map((column, index) => ({
      ...column,
      targetColNumber: index + 1,
      sourceColNumber: column.sourceColNumber === null
        ? null
        : (Number(column.sourceColNumber ?? column.colNumber) || null)
    }));

    // 在重建列之前完整保存单元格内容和样式。
    const rowHeights = [];
    const snapshots = [];
    for (let rowNumber = 1; rowNumber <= oldRowCount; rowNumber++) {
      rowHeights[rowNumber] = worksheet.getRow(rowNumber).height;
      snapshots[rowNumber] = columns.map(column => {
        if (!column.sourceColNumber || column.sourceColNumber > oldColumnCount) return null;
        const cell = worksheet.getCell(rowNumber, column.sourceColNumber);
        return {
          value: cell.value,
          style: cell.style ? JSON.parse(JSON.stringify(cell.style)) : {},
          note: cell.note,
          dataValidation: cell.dataValidation ? JSON.parse(JSON.stringify(cell.dataValidation)) : undefined
        };
      });
    }

    const mergeRanges = (worksheet.model?.merges || []).map(range => {
      const [startAddress, endAddress] = range.split(':');
      const start = worksheet.getCell(startAddress);
      const end = worksheet.getCell(endAddress || startAddress);
      return { startRow: start.row, endRow: end.row, startCol: start.col, endCol: end.col };
    });
    for (const range of [...(worksheet.model?.merges || [])]) {
      worksheet.unMergeCells(range);
    }

    if (oldColumnCount > 0) worksheet.spliceColumns(1, oldColumnCount);

    for (let rowNumber = 1; rowNumber <= oldRowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      if (rowHeights[rowNumber]) row.height = rowHeights[rowNumber];
      columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        const snapshot = snapshots[rowNumber][index];
        if (snapshot) {
          cell.value = snapshot.value;
          cell.style = snapshot.style;
          if (snapshot.note !== undefined) cell.note = snapshot.note;
          if (snapshot.dataValidation !== undefined) cell.dataValidation = snapshot.dataValidation;
        } else if (rowNumber === headerRow && column.style) {
          cell.style = JSON.parse(JSON.stringify(column.style));
        }
        if (rowNumber === headerRow) cell.value = column.header || '';
      });
    }

    columns.forEach((column, index) => {
      worksheet.getColumn(index + 1).width = Number(column.width) || 10;
    });

    // 仅恢复仍能连续映射到新列位置的合并区域。
    const sourceToTarget = new Map(
      columns.filter(column => column.sourceColNumber)
        .map(column => [column.sourceColNumber, column.targetColNumber])
    );
    for (const merge of mergeRanges) {
      const mapped = [];
      for (let col = merge.startCol; col <= merge.endCol; col++) {
        if (sourceToTarget.has(col)) mapped.push(sourceToTarget.get(col));
      }
      const sorted = [...mapped].sort((a, b) => a - b);
      const isComplete = mapped.length === merge.endCol - merge.startCol + 1;
      const isContiguous = sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
      const wasFullWidth = merge.startCol === 1 && merge.endCol === oldColumnCount;
      if (wasFullWidth && columns.length > 1) {
        worksheet.mergeCells(merge.startRow, 1, merge.endRow, columns.length);
      } else if (isComplete && isContiguous) {
        worksheet.mergeCells(merge.startRow, sorted[0], merge.endRow, sorted[sorted.length - 1]);
      }
    }

    await workbook.xlsx.writeFile(template.file_path);

    // 更新时间
    db.prepare('UPDATE templates SET updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), templateId);

    return true;
  }

  async _createBlankTemplateFile(filePath, type, customFields = []) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');
    const normalizedFields = Array.isArray(customFields)
      ? [...new Set(customFields
        .map(field => String(field || '').trim().replace(/^\{\{|\}\}$/g, '').trim())
        .filter(Boolean))]
      : [];
    if (normalizedFields.length > MAX_TEMPLATE_COLUMNS) {
      throw new Error(`字段数量不能超过 ${MAX_TEMPLATE_COLUMNS} 个`);
    }
    const columns = normalizedFields.length > 0
      ? normalizedFields.map(label => ({ label, width: Math.min(Math.max(label.length * 2 + 4, 12), 30) }))
      : this._getDefaultColumns(type);
    const headerRow = worksheet.getRow(1);
    headerRow.height = 28;

    columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = `{{${column.label}}}`;
      cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' }
      };
      worksheet.getColumn(index + 1).width = column.width || 15;
    });

    await workbook.xlsx.writeFile(filePath);
  }

  _detectHeaderRow(worksheet, effectiveColumnCount = getEffectiveColumnCount(worksheet)) {
    let bestRow = 1;
    let bestScore = -1;
    const maxRows = Math.min(worksheet.rowCount || 1, 50);
    for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
      let nonEmpty = 0;
      let placeholders = 0;
      forEachEffectiveCell(worksheet.getRow(rowNumber), effectiveColumnCount, cell => {
        const text = (cell.text || cell.value || '').toString().trim();
        if (!text) return;
        nonEmpty++;
        if (/\{\{[^}]+\}\}/.test(text)) placeholders++;
      });
      const score = placeholders * 1000 + nonEmpty;
      if (score > bestScore) {
        bestScore = score;
        bestRow = rowNumber;
      }
    }
    return bestRow;
  }

  _getDefaultColumns(type) {
    const typeConfigs = {
      '询价表': [
        ['供应商名称', 20], ['产品名称', 18], ['型号', 15], ['价格', 12],
        ['数量', 10], ['交货期', 12], ['付款方式', 12], ['备注', 20]
      ],
      '报价表': [
        ['报价编号', 15], ['产品名称', 18], ['型号', 15], ['数量', 10],
        ['单价', 12], ['总价', 12], ['成本', 12], ['利润', 12],
        ['交货期', 12], ['售后政策', 15]
      ],
      '供应商对比表': [
        ['产品名称', 15], ['型号', 12], ['供应商名称', 18], ['价格', 12],
        ['成本', 12], ['利润率', 10], ['售后政策', 15], ['付款方式', 12],
        ['交货期', 10], ['备注', 18]
      ],
      '客户报价单': [
        ['报价编号', 15], ['产品名称', 18], ['型号', 15], ['数量', 10],
        ['单价', 12], ['总价', 12], ['交货期', 12], ['保修期', 12],
        ['售后政策', 15], ['备注', 18]
      ]
    };
    const fallback = [
      ['供应商名称', 18], ['产品名称', 18], ['型号', 15], ['价格', 12],
      ['成本', 12], ['售后政策', 15], ['备注', 20]
    ];
    return (typeConfigs[type] || fallback).map(([label, width]) => ({ label, width }));
  }

  async getTemplatePreview(templateId) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(template.file_path);
    
    const preview = {
      name: template.name,
      sheets: []
    };

    workbook.eachSheet((worksheet) => {
      const effectiveColumnCount = getEffectiveColumnCount(worksheet);
      const sheetData = {
        name: worksheet.name,
        rows: [],
        maxRows: Math.min(worksheet.rowCount, 20),
        mergedCells: worksheet.model?.merges || []
      };

      for (let r = 1; r <= sheetData.maxRows; r++) {
        const row = worksheet.getRow(r);
        const cells = [];
        forEachEffectiveCell(row, effectiveColumnCount, (cell, col) => {
          cells.push({
            col,
            value: cell.text || cell.value || '',
            font: cell.font ? { name: cell.font.name, size: cell.font.size, bold: cell.font.bold, italic: cell.font.italic, color: cell.font.color?.argb } : null,
            fill: cell.fill?.fgColor?.argb ? { color: cell.fill.fgColor.argb } : null,
            alignment: cell.alignment ? { horizontal: cell.alignment.horizontal, vertical: cell.alignment.vertical } : null,
            border: cell.border || null,
            numFmt: cell.numFmt || null
          });
        });
        sheetData.rows.push({ rowNum: r, cells });
      }

      preview.sheets.push(sheetData);
    });

    return preview;
  }

  exportTemplate(templateId, destPath) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template || !fs.existsSync(template.file_path)) return false;

    fs.copyFileSync(template.file_path, destPath);
    return true;
  }

  duplicateTemplate(templateId) {
    const db = this.databaseProvider();
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) return null;

    const newId = uuidv4();
    const newPath = path.join(this.templatesDir, `${newId}.xlsx`);
    
    if (fs.existsSync(template.file_path)) {
      fs.copyFileSync(template.file_path, newPath);
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO templates (id, name, type, description, file_path, is_builtin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    `).run(newId, `${template.name} (副本)`, template.type, template.description, newPath, now, now);

    // 复制字段映射
    const mappings = db.prepare('SELECT * FROM field_mappings WHERE template_id = ?').all(templateId);
    const insertMapping = db.prepare('INSERT INTO field_mappings (template_id, template_field, system_field) VALUES (?, ?, ?)');
    for (const m of mappings) {
      insertMapping.run(newId, m.template_field, m.system_field);
    }

    return { id: newId, name: `${template.name} (副本)` };
  }
}

module.exports = { TemplateFileManager };
