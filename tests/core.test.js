const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { ExcelEngine } = require('../src/main/excelEngine');
const { TemplateFileManager } = require('../src/main/templateManager');
const { ExchangeRateService, parseRatePayload } = require('../src/main/exchangeRateService');
const { validateCustomFieldInput } = require('../src/main/systemFields');
const { normalizeReleaseNotes } = require('../src/main/releaseNotes');
const { cleanupPendingUpdateCache, getUpdaterCachePaths } = require('../src/main/updateCleanup');
const {
  detectHeader,
  parseItems,
  calculateUsdUnitPrice,
  fillRfqWorkbook
} = require('../src/main/rfqManager');
const {
  getGridNavigationTarget,
  parseClipboardGrid,
  applyGridPaste
} = require('../src/renderer/utils/gridNavigation');
const {
  getCandidateMatchScore,
  flattenQuoteSet,
  sortCandidatesForTarget
} = require('../src/renderer/utils/rfqMatching');
const packageConfig = require('../package.json');

function createTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-template-generator-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createFakeDatabase(template, mappings = [], customFields = []) {
  const writes = [];
  return {
    writes,
    prepare(sql) {
      if (sql.includes('SELECT * FROM templates WHERE id')) {
        return { get: () => template };
      }
      if (sql.includes('SELECT * FROM field_mappings')) {
        return { all: () => mappings };
      }
      if (sql.includes('SELECT key, data_type FROM custom_system_fields')) {
        return { all: () => customFields };
      }
      return {
        run: (...params) => {
          writes.push({ sql, params });
          return { changes: 1 };
        }
      };
    }
  };
}

test('installer packaging excludes user templates and local data', () => {
  const packagedFiles = packageConfig.build?.files || [];
  assert.equal(packagedFiles.includes('templates/**/*'), false);
  assert.equal(packagedFiles.includes('data/**/*'), false);
  assert.equal(Array.isArray(packageConfig.build?.extraResources), false);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /app\.getPath\('userData'\).*templates/);
  assert.match(mainSource, /initDatabase\(\)/);
});

test('a fresh user profile starts with an empty template directory', t => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-template-generator-fresh-user-'));
  t.after(() => fs.rmSync(userDataDir, { recursive: true, force: true }));
  const templatesDir = path.join(userDataDir, 'templates');
  const manager = new TemplateFileManager(templatesDir, () => ({
    prepare: () => ({ all: () => [] })
  }));

  assert.equal(fs.existsSync(templatesDir), true);
  assert.deepEqual(manager.listTemplates(), []);
});

test('new templates create a usable xlsx file', async t => {
  const dir = createTempDir(t);
  const db = createFakeDatabase(null);
  const manager = new TemplateFileManager(dir, () => db);

  const result = await manager.saveTemplate({ name: '测试报价单', type: '报价表' });

  assert.equal(fs.existsSync(result.filePath), true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);
  assert.equal(workbook.worksheets[0].getCell('A1').value, '{{报价编号}}');
  assert.ok(workbook.worksheets[0].columnCount >= 8);
});

test('daily USD/CNY exchange rate is validated and cached for the current day', async t => {
  const dir = createTempDir(t);
  let fetchCount = 0;
  const service = new ExchangeRateService(dir, async () => {
    fetchCount++;
    return { date: '2026-07-23', rates: { CNY: 7.1234 } };
  });

  assert.deepEqual(parseRatePayload({ date: '2026-07-23', rates: { CNY: 7.1234 } }), {
    rate: 7.1234,
    referenceDate: '2026-07-23'
  });
  const first = await service.getToday();
  const second = await service.getToday();
  assert.equal(first.success, true);
  assert.equal(first.rate, 7.1234);
  assert.equal(second.cached, true);
  assert.equal(fetchCount, 1);
});

test('custom system fields validate names and preserve their selected data type', () => {
  assert.deepEqual(validateCustomFieldInput({ label: ' 包装重量 ', dataType: 'number' }, []), {
    label: '包装重量',
    dataType: 'number'
  });
  assert.throws(
    () => validateCustomFieldInput({ label: '包装重量' }, [{ label: ' 包装重量 ' }]),
    /已存在/
  );
  assert.equal(validateCustomFieldInput({ label: '营业执照', dataType: 'file' }, []).dataType, 'file');
  assert.equal(validateCustomFieldInput({ label: '厂房图片', dataType: 'image' }, []).dataType, 'image');
});

test('GitHub release notes are normalized for the update dialog', () => {
  assert.equal(
    normalizeReleaseNotes('<ul><li>修复更新问题</li><li>增加附件功能</li></ul>'),
    '• 修复更新问题\n• 增加附件功能'
  );
  assert.equal(
    normalizeReleaseNotes([{ version: '1.0.19', note: '<p>显示更新说明</p>' }]),
    'v1.0.19\n显示更新说明'
  );
});

test('grid arrow navigation moves between editable rows and columns', () => {
  const base = {
    rowIndex: 1,
    columnIndex: 2,
    rowCount: 3,
    navigableColumns: [0, 2, 4]
  };

  assert.deepEqual(getGridNavigationTarget({ ...base, key: 'ArrowUp' }), {
    rowIndex: 0,
    columnIndex: 2,
    appendRow: false
  });
  assert.deepEqual(getGridNavigationTarget({ ...base, key: 'ArrowDown' }), {
    rowIndex: 2,
    columnIndex: 2,
    appendRow: false
  });
  assert.deepEqual(getGridNavigationTarget({ ...base, key: 'ArrowLeft' }), {
    rowIndex: 1,
    columnIndex: 0,
    appendRow: false
  });
  assert.deepEqual(getGridNavigationTarget({ ...base, key: 'ArrowRight' }), {
    rowIndex: 1,
    columnIndex: 4,
    appendRow: false
  });
});

test('ArrowDown on the final row requests a new row in the same column', () => {
  assert.deepEqual(getGridNavigationTarget({
    key: 'ArrowDown',
    rowIndex: 2,
    columnIndex: 0,
    rowCount: 3,
    navigableColumns: [0, 1]
  }), {
    rowIndex: 3,
    columnIndex: 0,
    appendRow: true
  });
  assert.equal(getGridNavigationTarget({
    key: 'ArrowUp',
    rowIndex: 0,
    columnIndex: 0,
    rowCount: 1,
    navigableColumns: [0]
  }), null);
});

test('multi-cell clipboard data fills matching fields and adds missing rows', () => {
  const fields = [
    { key: 'supplierName' },
    { key: 'attachment' },
    { key: 'model' },
    { key: 'price' }
  ];
  const grid = parseClipboardGrid('供应商甲\tM1\t100\r\n供应商乙\tM2\t200\r\n');
  assert.deepEqual(grid, [
    ['供应商甲', 'M1', '100'],
    ['供应商乙', 'M2', '200']
  ]);

  const result = applyGridPaste({
    items: [{ quantity: '1' }],
    fields,
    navigableColumns: [0, 2, 3],
    startRow: 0,
    startColumn: 0,
    grid,
    createItem: () => ({ quantity: '1' })
  });

  assert.equal(result.pastedCells, 6);
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    quantity: '1',
    supplierName: '供应商甲',
    model: 'M1',
    price: '100'
  });
  assert.deepEqual(result.items[1], {
    quantity: '1',
    supplierName: '供应商乙',
    model: 'M2',
    price: '200'
  });
  assert.equal(result.lastRow, 1);
  assert.equal(result.lastColumn, 3);
});

test('database schema includes migrations, drafts and backup protection', () => {
  const databaseSource = fs.readFileSync(path.join(__dirname, '../src/main/database.js'), 'utf8');
  const maintenanceSource = fs.readFileSync(
    path.join(__dirname, '../src/main/databaseMaintenance.js'),
    'utf8'
  );
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS data_entry_drafts/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS app_settings/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS rfq_projects/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS rfq_items/);
  assert.match(databaseSource, /CREATE TABLE IF NOT EXISTS rfq_selections/);
  assert.match(maintenanceSource, /integrity_check/);
  assert.match(maintenanceSource, /before-restore/);
  assert.match(maintenanceSource, /BACKUP_RETENTION = 10/);
});

test('Spanish customer RFQ headers and product rows are detected', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SP_BRAYAN CUBIDES');
  sheet.getCell('B9').value = 'Fecha:';
  sheet.getCell('C9').value = new Date('2026-07-29');
  sheet.getRow(14).values = [
    null,
    'Item',
    'Tipo',
    'Imagen de Referencia',
    'Referencia',
    'Código',
    'Descripción (Específica)',
    'Link de Referencia',
    'Marcado con Latic',
    'Precio Unitario antes de IVA (USD)',
    'Cantidad',
    'Unidad de Medida',
    'Precio Total antes de IVA (USD)',
    'Forma de Pago',
    'País',
    'Tipo de Importación',
    'Tiempo de Importación'
  ];
  sheet.getRow(15).values = [
    null, 1, 'Otro', null, 'HG114AX15', 'N/A',
    'ONU xPON LATIC', 'n/a', 'No', null, 500, 'Und.', 0,
    'Contado', 'HONDURAS', 'Marítima', 0
  ];

  const header = detectHeader(sheet);
  const items = parseItems(sheet, header);
  assert.equal(header.rowNumber, 14);
  assert.equal(header.columns.reference, 5);
  assert.equal(header.columns.unitPriceUsd, 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].data.reference, 'HG114AX15');
  assert.equal(items[0].data.quantity, 500);
});

test('selected supplier price is converted to USD using saved exchange and invoice rules', () => {
  assert.equal(
    Number(calculateUsdUnitPrice(
      { price: 198 },
      { price: '总价' },
      { exchangeRate: 6.77, invoiceType: 'special' }
    ).toFixed(6)),
    25.882015
  );
  assert.equal(
    calculateUsdUnitPrice(
      { usdCost: 25.88, price: 198 },
      {},
      { exchangeRate: 6.77, invoiceType: 'special' }
    ),
    25.88
  );
});

test('supplier candidates are grouped and ranked by model reference', () => {
  const quoteSet = {
    id: 'quotes-1',
    name: '供应商询价',
    batches: [
      {
        category: 'ONU',
        items: [
          { supplierName: '供应商甲', model: 'HG114AX15', price: 198 },
          { supplierName: '供应商乙', model: 'OTHER', price: 180 }
        ]
      }
    ]
  };
  const candidates = flattenQuoteSet(quoteSet);
  const ranked = sortCandidatesForTarget({ reference: 'HG114AX15' }, candidates);
  assert.equal(candidates.length, 2);
  assert.equal(ranked[0].candidate.supplierName, '供应商甲');
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(
    getCandidateMatchScore({ reference: 'HG114AX15' }, { model: 'HG114AX15' }),
    145
  );
});

test('downloaded updates are scheduled for automatic installation and relaunch', () => {
  const updateSource = fs.readFileSync(path.join(__dirname, '../src/main/updateManager.js'), 'utf8');
  assert.match(updateSource, /scheduleAutomaticInstall\(\)/);
  assert.match(updateSource, /quitAndInstall\(true, true\)/);
  assert.match(updateSource, /createDatabaseBackup\('before-update'\)/);
});

test('completed updates clean only this app updater pending directory', async t => {
  const dir = createTempDir(t);
  const { cacheDir, pendingDir } = getUpdaterCachePaths(dir);
  const keepFile = path.join(cacheDir, 'keep.txt');
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(path.join(pendingDir, 'old-installer.exe'), 'installer');
  fs.writeFileSync(path.join(pendingDir, 'update-info.json'), '{}');
  fs.writeFileSync(keepFile, 'keep');

  const result = await cleanupPendingUpdateCache(dir);
  assert.equal(result.removed, 2);
  assert.deepEqual(fs.readdirSync(pendingDir), []);
  assert.equal(fs.existsSync(keepFile), true);
});

test('template name type and description can be updated without replacing its file', async t => {
  const dir = createTempDir(t);
  const filePath = path.join(dir, 'template.xlsx');
  fs.writeFileSync(filePath, 'unchanged');
  const template = { id: 'editable-template', name: '旧名称', type: '通用', description: '', file_path: filePath };
  const db = createFakeDatabase(template);
  const manager = new TemplateFileManager(dir, () => db);

  const result = manager.updateTemplateInfo(template.id, {
    name: '供应商汇总',
    type: '供应商对比表',
    description: '供应商主档与资质附件'
  });

  assert.equal(result.name, '供应商汇总');
  assert.equal(result.type, '供应商对比表');
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'unchanged');
  assert.ok(db.writes.some(write => write.sql.includes('UPDATE templates')));
});

test('new templates can be generated directly from custom field names', async t => {
  const dir = createTempDir(t);
  const db = createFakeDatabase(null);
  const manager = new TemplateFileManager(dir, () => db);

  const result = await manager.saveTemplate({
    name: '自定义询价模板',
    type: '通用',
    fields: ['公司名称', '型号', '含税价格', '型号', '{{备注}}', '  ']
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(result.filePath);
  const sheet = workbook.worksheets[0];
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    '{{公司名称}}', '{{型号}}', '{{含税价格}}', '{{备注}}'
  ]);
  assert.equal(sheet.columnCount, 4);
});

test('template structure changes are persisted with content and merges', async t => {
  const dir = createTempDir(t);
  const filePath = path.join(dir, 'structure.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = '报价单';
  sheet.getRow(2).values = ['{{产品名称}}', '{{型号}}', '{{价格}}'];
  sheet.getRow(3).values = ['产品A', 'M1', 100];
  await workbook.xlsx.writeFile(filePath);

  const template = { id: 'template-1', file_path: filePath };
  const db = createFakeDatabase(template);
  const manager = new TemplateFileManager(dir, () => db);
  const structure = await manager.getTemplateStructure(template.id);
  structure.columns = [structure.columns[2], structure.columns[0], structure.columns[1]];
  structure.columns[0].header = '{{含税价格}}';

  assert.equal(await manager.updateTemplateStructure(template.id, structure), true);

  const updated = new ExcelJS.Workbook();
  await updated.xlsx.readFile(filePath);
  const updatedSheet = updated.worksheets[0];
  assert.equal(updatedSheet.getCell('A2').value, '{{含税价格}}');
  assert.equal(updatedSheet.getCell('B3').value, '产品A');
  assert.ok(updatedSheet.model.merges.includes('A1:C1'));
});

test('generation auto-detects the header and preserves title and footer rows', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'template.xlsx');
  const outputPath = path.join(dir, 'output.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('报价单');
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = '客户报价单';
  sheet.getRow(2).values = ['{{产品名称}}', '{{型号}}', '{{价格}}'];
  sheet.getCell('A3').value = '说明：价格有效期 30 天';
  await workbook.xlsx.writeFile(templatePath);

  const template = { id: 'template-2', file_path: templatePath };
  const mappings = [
    { template_field: '产品名称', system_field: 'productName' },
    { template_field: '型号', system_field: 'model' },
    { template_field: '价格', system_field: 'price' }
  ];
  const engine = new ExcelEngine(createFakeDatabase(template, mappings), { templatesDir: dir });

  await engine.generate(template.id, [{
    category: '无分类',
    items: [{ productName: '产品A', model: 'M1', price: '88.5', quantity: '1' }]
  }], outputPath, { autoQuoteNumber: false });

  const generated = new ExcelJS.Workbook();
  await generated.xlsx.readFile(outputPath);
  const generatedSheet = generated.worksheets[0];
  assert.equal(generatedSheet.getCell('A1').value, '客户报价单');
  assert.equal(generatedSheet.getCell('A2').value, '产品名称');
  assert.equal(generatedSheet.getCell('A3').value, '产品A');
  assert.equal(generatedSheet.getCell('C3').value, 88.5);
  assert.equal(generatedSheet.getCell('A4').value, '说明：价格有效期 30 天');
});

test('categorized generation repeats the header below every category row', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'categorized-template.xlsx');
  const outputPath = path.join(dir, 'categorized-output.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('询价单');
  sheet.mergeCells('A1:C1');
  sheet.getCell('A1').value = '询价汇总';
  sheet.getRow(2).values = ['{{公司名称}}', '{{型号}}', '{{价格}}'];
  sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAF7' } };
  sheet.getCell('A3').value = '页尾说明';
  await workbook.xlsx.writeFile(templatePath);

  const template = { id: 'template-categories', file_path: templatePath };
  const mappings = [
    { template_field: '公司名称', system_field: 'supplierName' },
    { template_field: '型号', system_field: 'model' },
    { template_field: '价格', system_field: 'price' }
  ];
  const engine = new ExcelEngine(createFakeDatabase(template, mappings), { templatesDir: dir });

  await engine.generate(template.id, [
    { category: '发射机', items: [{ supplierName: '供应商甲', model: 'TX-1', price: '100' }] },
    { category: '方向盘套', items: [{ supplierName: '供应商乙', model: 'ST-2', price: '200' }] }
  ], outputPath, { autoQuoteNumber: false });

  const generated = new ExcelJS.Workbook();
  await generated.xlsx.readFile(outputPath);
  const result = generated.worksheets[0];
  assert.equal(result.getCell('A1').value, '询价汇总');
  assert.equal(result.getCell('A2').value, '发射机');
  assert.equal(result.getCell('A3').value, '公司名称');
  assert.equal(result.getCell('A4').value, '供应商甲');
  assert.equal(result.getCell('A5').value, '方向盘套');
  assert.equal(result.getCell('A6').value, '公司名称');
  assert.equal(result.getCell('A7').value, '供应商乙');
  assert.equal(result.getCell('A8').value, '页尾说明');
  assert.ok(result.model.merges.includes('A2:C2'));
  assert.ok(result.model.merges.includes('A5:C5'));
  assert.equal(result.getCell('A3').fill.fgColor.argb, 'FFD9EAF7');
  assert.equal(result.getCell('A6').fill.fgColor.argb, 'FFD9EAF7');

  const reopened = await engine.readExisting(outputPath, template.id);
  assert.equal(reopened.success, true);
  assert.equal(reopened.exact, true);
  assert.equal(reopened.templateId, template.id);
  assert.equal(reopened.batches.length, 2);
  assert.equal(reopened.batches[0].category, '发射机');
  assert.equal(reopened.batches[0].items[0].supplierName, '供应商甲');
  assert.equal(reopened.batches[1].category, '方向盘套');
  assert.equal(reopened.batches[1].items[0].model, 'ST-2');
});

test('generated workbooks auto-fit long content and remove placeholder braces from headers', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'auto-fit-template.xlsx');
  const outputPath = path.join(dir, 'auto-fit-output.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('供应商');
  sheet.getRow(1).values = ['{{公司名称}}', '{{备注}}'];
  sheet.getColumn(1).width = 8;
  sheet.getColumn(2).width = 8;
  await workbook.xlsx.writeFile(templatePath);

  const template = { id: 'auto-fit-template', file_path: templatePath };
  const mappings = [
    { template_field: '公司名称', system_field: 'supplierName' },
    { template_field: '备注', system_field: 'notes' }
  ];
  const engine = new ExcelEngine(createFakeDatabase(template, mappings), { templatesDir: dir });
  const longNotes = '数量少，不含进仓和港杂费；需要整批发货，并且按照实际包装尺寸重新确认运输费用。';

  await engine.generate(template.id, [{
    category: '无分类',
    items: [{ supplierName: '测试供应商', notes: longNotes }]
  }], outputPath, { autoQuoteNumber: false });

  const generated = new ExcelJS.Workbook();
  await generated.xlsx.readFile(outputPath);
  const result = generated.worksheets[0];
  assert.equal(result.getCell('A1').value, '公司名称');
  assert.equal(result.getCell('B1').value, '备注');
  assert.ok(result.getColumn(2).width > 8);
  assert.ok(result.getRow(2).height > 18);
});

test('legacy generated workbooks can be reopened using their original template mapping', async t => {
  const dir = createTempDir(t);
  const filePath = path.join(dir, 'legacy-output.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('询价单');
  sheet.getRow(1).values = ['{{公司名称}}', '{{型号}}', '{{价格}}'];
  sheet.mergeCells('A2:C2');
  sheet.getCell('A2').value = '旧版大类';
  sheet.getRow(3).values = ['供应商甲', 'OLD-1', 88];
  await workbook.xlsx.writeFile(filePath);

  const template = { id: 'legacy-template', name: '旧版模板', file_path: filePath };
  const mappings = [
    { template_field: '公司名称', system_field: 'supplierName' },
    { template_field: '型号', system_field: 'model' },
    { template_field: '价格', system_field: 'price' }
  ];
  const engine = new ExcelEngine(createFakeDatabase(template, mappings), { templatesDir: dir });
  const reopened = await engine.readExisting(filePath, template.id);

  assert.equal(reopened.exact, false);
  assert.equal(reopened.batches.length, 1);
  assert.equal(reopened.batches[0].category, '旧版大类');
  assert.equal(reopened.batches[0].items[0].supplierName, '供应商甲');
  assert.equal(reopened.batches[0].items[0].price, '88');
});

test('USD cost is calculated from total price using exchange rate and invoice type', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'usd-template.xlsx');
  const specialPath = path.join(dir, 'usd-special.xlsx');
  const regularPath = path.join(dir, 'usd-regular.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('询价单');
  sheet.getRow(1).values = ['{{含税含运}}', '{{美金成本}}'];
  await workbook.xlsx.writeFile(templatePath);

  const template = { id: 'usd-template', name: '美金换算模板', file_path: templatePath };
  const mappings = [
    // 模拟旧模板误映射成 totalPrice，生成时仍应按表头识别为 price。
    { template_field: '含税含运', system_field: 'totalPrice' },
    // 即使旧模板误映射成 cost，也应按“美金成本”表头识别为自动换算列。
    { template_field: '美金成本', system_field: 'cost' }
  ];
  const engine = new ExcelEngine(createFakeDatabase(template, mappings), { templatesDir: dir });
  const batches = [{ category: '无分类', items: [{ price: '113' }] }];

  await engine.generate(template.id, batches, specialPath, {
    autoQuoteNumber: false,
    exchangeRate: 10,
    invoiceType: 'special'
  });
  await engine.generate(template.id, batches, regularPath, {
    autoQuoteNumber: false,
    exchangeRate: 10,
    invoiceType: 'regular'
  });

  const specialBook = new ExcelJS.Workbook();
  await specialBook.xlsx.readFile(specialPath);
  const regularBook = new ExcelJS.Workbook();
  await regularBook.xlsx.readFile(regularPath);
  assert.equal(specialBook.worksheets[0].getCell('A2').value, 113);
  assert.equal(specialBook.worksheets[0].getCell('B2').value, 10);
  assert.equal(specialBook.worksheets[0].getCell('B2').numFmt, '$#,##0.00;[Red]-$#,##0.00');
  assert.equal(regularBook.worksheets[0].getCell('A2').value, 113);
  assert.equal(regularBook.worksheets[0].getCell('B2').value, 11.3);
  assert.equal(regularBook.worksheets[0].getCell('B2').numFmt, '$#,##0.00;[Red]-$#,##0.00');
});

test('custom numeric system fields are written to Excel as numbers', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'custom-field-template.xlsx');
  const outputPath = path.join(dir, 'custom-field-output.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('产品表');
  sheet.getRow(1).values = ['{{品牌}}', '{{包装重量}}'];
  await workbook.xlsx.writeFile(templatePath);

  const template = { id: 'custom-fields', name: '自定义字段模板', file_path: templatePath };
  const mappings = [
    { template_field: '品牌', system_field: 'custom_brand' },
    { template_field: '包装重量', system_field: 'custom_weight' }
  ];
  const customFields = [
    { key: 'custom_brand', data_type: 'text' },
    { key: 'custom_weight', data_type: 'number' }
  ];
  const engine = new ExcelEngine(
    createFakeDatabase(template, mappings, customFields),
    { templatesDir: dir }
  );

  await engine.generate(template.id, [{
    category: '无分类',
    items: [{ custom_brand: '测试品牌', custom_weight: '12.5' }]
  }], outputPath, { autoQuoteNumber: false });

  const generated = new ExcelJS.Workbook();
  await generated.xlsx.readFile(outputPath);
  assert.equal(generated.worksheets[0].getCell('A2').value, '测试品牌');
  assert.equal(generated.worksheets[0].getCell('B2').value, 12.5);
  assert.equal(generated.worksheets[0].getCell('B2').numFmt, '#,##0.00');
});

test('attachments are archived, linked, embedded and restored for continued editing', async t => {
  const dir = createTempDir(t);
  const templatePath = path.join(dir, 'attachment-template.xlsx');
  const outputPath = path.join(dir, 'supplier-summary.xlsx');
  const pdfPath = path.join(dir, '营业执照.pdf');
  const imagePath = path.join(dir, '厂房图片.png');
  fs.writeFileSync(pdfPath, '%PDF-1.4\n%%EOF');
  fs.writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  ));

  const templateBook = new ExcelJS.Workbook();
  const templateSheet = templateBook.addWorksheet('供应商汇总');
  templateSheet.getRow(1).values = ['{{供应商名称}}', '{{营业执照}}', '{{厂房图片}}'];
  await templateBook.xlsx.writeFile(templatePath);

  const template = { id: 'attachment-template', name: '供应商汇总', file_path: templatePath };
  const mappings = [
    { template_field: '供应商名称', system_field: 'supplierName' },
    { template_field: '营业执照', system_field: 'custom_license' },
    { template_field: '厂房图片', system_field: 'custom_factory_image' }
  ];
  const customFields = [
    { key: 'custom_license', data_type: 'file' },
    { key: 'custom_factory_image', data_type: 'image' }
  ];
  const engine = new ExcelEngine(
    createFakeDatabase(template, mappings, customFields),
    { templatesDir: dir }
  );

  await engine.generate(template.id, [{
    category: '无分类',
    items: [{
      supplierName: '测试供应商',
      custom_license: { kind: 'file', path: pdfPath, name: '营业执照.pdf', extension: 'pdf' },
      custom_factory_image: { kind: 'image', path: imagePath, name: '厂房图片.png', extension: 'png' }
    }]
  }], outputPath, { autoQuoteNumber: false });

  const attachmentDir = path.join(dir, 'supplier-summary_附件');
  assert.equal(fs.existsSync(attachmentDir), true);
  assert.equal(fs.readdirSync(attachmentDir).length, 2);

  const generated = new ExcelJS.Workbook();
  await generated.xlsx.readFile(outputPath);
  const sheet = generated.worksheets[0];
  assert.equal(sheet.getCell('A2').value, '测试供应商');
  assert.match(sheet.getCell('B2').value.hyperlink, /^supplier-summary_附件\//);
  assert.equal(sheet.getImages().length, 1);
  assert.ok((sheet.getRow(2).height || 0) >= 62);

  const reopened = await engine.readExisting(outputPath);
  const reopenedItem = reopened.batches[0].items[0];
  assert.equal(fs.existsSync(reopenedItem.custom_license.path), true);
  assert.equal(fs.existsSync(reopenedItem.custom_factory_image.path), true);
});

test('full-width merged rows do not create 16384 rendered fields', async t => {
  const dir = createTempDir(t);
  const filePath = path.join(dir, 'full-width-merge.xlsx');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.mergeCells('A1:XFD1');
  sheet.getCell('A1').value = '产品分类标题';
  sheet.getRow(2).values = [
    '公司名称', '型号', '出厂价（人民币元）', '含税含运（人民币元）',
    '美金成本（USD）', '售后政策', '备注'
  ];
  await workbook.xlsx.writeFile(filePath);

  const template = { id: 'template-wide', name: '宽合并模板', file_path: filePath };
  const manager = new TemplateFileManager(dir, () => createFakeDatabase(template));
  const structure = await manager.getTemplateStructure(template.id);
  const preview = await manager.getTemplatePreview(template.id);

  assert.equal(structure.headerRow, 2);
  assert.equal(structure.colCount, 7);
  assert.equal(structure.columns.length, 7);
  assert.equal(preview.sheets[0].rows[0].cells.length, 1);
  assert.equal(preview.sheets[0].rows[1].cells.length, 7);
});

test('RFQ output uses unified headers and exports note images and files', async t => {
  const dir = createTempDir(t);
  const sourcePath = path.join(dir, 'rfq-source.xlsx');
  const outputPath = path.join(dir, 'rfq-filled.xlsx');
  const textPath = path.join(dir, 'catalog.pdf');
  const imagePath = path.join(dir, 'product.png');
  fs.writeFileSync(textPath, 'test attachment');
  fs.writeFileSync(
    imagePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=', 'base64')
  );

  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet('RFQ');
  sheet.getRow(1).values = [
    'Item', 'Referencia', 'Descripcion', 'Cantidad', 'Precio unitario USD'
  ];
  sheet.getRow(2).values = [1, 'A-1', 'File item', 2, ''];
  sheet.getRow(3).values = [2, 'B-1', 'Image item', 1, ''];
  await source.xlsx.writeFile(sourcePath);

  const items = [
    { id: 'item-1', source_row: 2 },
    { id: 'item-2', source_row: 3 }
  ];
  const quoteSet = {
    id: 'quotes',
    fieldLabels: { price: '总价', notes: '备注' },
    options: { exchangeRate: 7.25, invoiceType: 'regular' }
  };
  const selections = [
    {
      itemId: 'item-1',
      quoteEntryId: 'quotes',
      selectedData: {
        price: 100,
        _rfqNotes: '文件说明',
        _rfqAttachment: {
          kind: 'file', path: textPath, name: '产品图册.pdf', extension: 'pdf'
        }
      }
    },
    {
      itemId: 'item-2',
      quoteEntryId: 'quotes',
      selectedData: {
        price: 200,
        _rfqNotes: '图片说明',
        _rfqAttachment: {
          kind: 'image', path: imagePath, name: '产品图片.png', extension: 'png'
        }
      }
    }
  ];

  await fillRfqWorkbook({
    sourceFile: sourcePath,
    sheetName: 'RFQ',
    items,
    selections,
    quoteSets: [quoteSet],
    outputPath,
    options: quoteSet.options
  });

  const result = new ExcelJS.Workbook();
  await result.xlsx.readFile(outputPath);
  const resultSheet = result.getWorksheet('RFQ');
  assert.deepEqual(
    [resultSheet.getCell('F1').value, resultSheet.getCell('G1').value, resultSheet.getCell('H1').value],
    ['FOB', '总价', '备注']
  );
  assert.match(resultSheet.getCell('H2').value.hyperlink, /^rfq-filled_附件\//);
  assert.match(resultSheet.getCell('H2').value.text, /文件说明/);
  assert.equal(resultSheet.getImages().length, 1);
  assert.equal(resultSheet.getCell('H3').value, '图片说明');
  assert.ok((resultSheet.getRow(3).height || 0) >= 62);
  assert.equal(fs.readdirSync(path.join(dir, 'rfq-filled_附件')).length, 2);
});
