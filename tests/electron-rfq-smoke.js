const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { app } = require('electron');

const sourcePath = process.argv[2];
const reportPath = process.argv[3];
if (!sourcePath) {
  process.stderr.write('Usage: electron electron-rfq-smoke.js <source.xlsx>');
  process.exit(2);
}

const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-template-generator-rfq-'));
app.setPath('userData', userDataPath);

app.whenReady().then(async () => {
  const { initDatabase, getDatabase, closeDatabase } = require('../src/main/database');
  const { RfqManager, detectHeader } = require('../src/main/rfqManager');
  try {
    initDatabase();
    const manager = new RfqManager(getDatabase, path.join(userDataPath, 'rfq-sources'));
    const project = await manager.importProject(sourcePath);
    if (!project.items.length) throw new Error('no imported RFQ items');

    const quote = {
      supplierName: '内测供应商',
      model: project.items[0].data.reference || 'TEST-MODEL',
      price: 198,
      paymentTerms: 'Contado',
      deliveryTime: '30 días',
      notes: '自动回填内测'
    };
    const quoteSet = manager.saveQuoteSet({
      name: '内测供应商询价',
      batches: [{ category: '内测', items: [quote] }],
      fieldLabels: {
        supplierName: '供应商名称',
        model: '型号',
        price: '总价',
        paymentTerms: '付款方式',
        deliveryTime: '交期',
        notes: '备注'
      },
      options: { exchangeRate: 6.77, invoiceType: 'special' }
    });
    const selections = project.items.map(item => ({
      itemId: item.id,
      quoteEntryId: quoteSet.id,
      quoteItemIndex: 0,
      supplierName: quote.supplierName,
      selectedData: quote
    }));
    const outputPath = path.join(userDataPath, 'filled-rfq.xlsx');
    await manager.generateFilled(project.id, selections, outputPath, {
      exchangeRate: 6.77,
      invoiceType: 'special'
    });

    const resultBook = new ExcelJS.Workbook();
    await resultBook.xlsx.readFile(outputPath);
    const sheet = resultBook.getWorksheet(project.sheet_name);
    const header = detectHeader(sheet);
    const row = project.items[0].source_row;
    const unitPrice = Number(sheet.getCell(row, header.columns.unitPriceUsd).value);
    const totalValue = sheet.getCell(row, header.columns.totalPriceUsd).value;
    if (Math.abs(unitPrice - 25.88) > 0.001) throw new Error(`unexpected USD price: ${unitPrice}`);
    if (!totalValue?.formula) throw new Error('total USD formula was not preserved/generated');

    const report = {
      projectId: project.id,
      items: project.items.length,
      sheet: project.sheet_name,
      unitPrice,
      totalFormula: totalValue.formula,
      images: sheet.getImages().length,
      outputExists: fs.existsSync(outputPath)
    };
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    process.stdout.write(JSON.stringify(report));
    closeDatabase();
    fs.rmSync(userDataPath, { recursive: true, force: true });
    app.quit();
  } catch (error) {
    try { closeDatabase(); } catch (closeError) {}
    fs.rmSync(userDataPath, { recursive: true, force: true });
    process.stderr.write(error.stack || error.message);
    app.exit(1);
  }
});
