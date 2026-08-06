const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const {
  findBestSheet,
  parseItems,
  fillRfqWorkbook
} = require('../src/main/rfqManager');

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(await fs.promises.readFile(filePath));
  return hash.digest('hex');
}

async function main() {
  const sourceFile = process.argv[2];
  if (!sourceFile || !fs.existsSync(sourceFile)) {
    throw new Error('Usage: node tests/rfq-file-validation.js <source.xlsx>');
  }

  const sourceHashBefore = await sha256(sourceFile);
  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(sourceFile);
  const { worksheet, header } = findBestSheet(sourceWorkbook);
  const parsedItems = parseItems(worksheet, header);
  if (!parsedItems.length) throw new Error('No RFQ product rows detected');

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rfq-beta-validation-'));
  const outputPath = path.join(tempDir, 'filled-rfq.xlsx');
  const items = parsedItems.map((item, index) => ({
    id: `item-${index + 1}`,
    line_no: index + 1,
    source_row: item.sourceRow,
    data: item.data
  }));
  const selectedData = {
    supplierName: '内测供应商',
    model: items[0].data.reference || 'TEST-MODEL',
    price: 198,
    paymentTerms: '月结30天',
    deliveryTime: '30天',
    notes: '内测自动回填'
  };
  const quoteSet = {
    id: 'quote-set-1',
    fieldLabels: {
      supplierName: '供应商名称',
      model: '型号',
      price: '总价',
      paymentTerms: '付款方式',
      deliveryTime: '交期',
      notes: '备注'
    },
    options: { exchangeRate: 6.77, invoiceType: 'special' }
  };
  const selections = items.map(item => ({
    itemId: item.id,
    quoteEntryId: quoteSet.id,
    selectedData
  }));

  await fillRfqWorkbook({
    sourceFile,
    sheetName: worksheet.name,
    headerRow: header.rowNumber,
    items,
    selections,
    quoteSets: [quoteSet],
    outputPath,
    options: quoteSet.options
  });

  const resultWorkbook = new ExcelJS.Workbook();
  await resultWorkbook.xlsx.readFile(outputPath);
  const resultSheet = resultWorkbook.getWorksheet(worksheet.name);
  const resultHeader = findBestSheet(resultWorkbook).header;
  const firstRow = items[0].source_row;
  const unitPrice = Number(resultSheet.getCell(firstRow, resultHeader.columns.unitPriceUsd).value);
  const totalValue = resultSheet.getCell(firstRow, resultHeader.columns.totalPriceUsd).value;
  const expectedUnit = Number((198 / 6.77 / 1.13).toFixed(2));
  if (Math.abs(unitPrice - expectedUnit) > 0.001) {
    throw new Error(`Unexpected unit USD price: ${unitPrice}, expected ${expectedUnit}`);
  }
  if (!totalValue || typeof totalValue !== 'object' || !totalValue.formula) {
    throw new Error('Total USD formula is missing');
  }
  if (
    resultHeader.columns.incoterm !== 19 ||
    resultHeader.columns.totalRmb !== 20 ||
    resultHeader.columns.notes !== 21
  ) {
    throw new Error(`Generated fields are not adjacent to the visible table: ${JSON.stringify(resultHeader.columns)}`);
  }
  if ([19, 20, 21].some(column => resultSheet.getColumn(column).hidden)) {
    throw new Error('Generated output columns must remain visible');
  }
  const outputHeaders = [19, 20, 21].map(column => resultSheet.getCell(resultHeader.rowNumber, column).value);
  if (JSON.stringify(outputHeaders) !== JSON.stringify(['FOB', '总价', '备注'])) {
    throw new Error(`Unexpected unified output headers: ${JSON.stringify(outputHeaders)}`);
  }
  const paymentValidation = resultSheet.dataValidations.model.N15;
  if (!paymentValidation?.formulae?.includes('$Z$5:$Z$13')) {
    throw new Error('Hidden dropdown references were not shifted with the inserted columns');
  }
  if ((resultSheet.getImages?.() || []).length < (worksheet.getImages?.() || []).length) {
    throw new Error('Embedded images were lost during fill');
  }

  const sourceHashAfter = await sha256(sourceFile);
  if (sourceHashAfter !== sourceHashBefore) {
    throw new Error('Source workbook was modified');
  }

  const report = {
    source: path.basename(sourceFile),
    sheet: worksheet.name,
    headerRow: header.rowNumber,
    items: items.length,
    unitPrice,
    totalFormula: totalValue.formula,
    outputColumns: {
      fob: resultHeader.columns.incoterm,
      totalRmb: resultHeader.columns.totalRmb,
      notes: resultHeader.columns.notes
    },
    sourceImages: (worksheet.getImages?.() || []).length,
    outputImages: (resultSheet.getImages?.() || []).length,
    sourceUnchanged: true,
    outputBytes: fs.statSync(outputPath).size
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
