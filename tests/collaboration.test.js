const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { hashPassword, verifyPassword, createSessionToken, hashToken } = require('../server/lib/passwords');
const { importRfqWorkbook } = require('../server/services/rfqImporter');
const { exportCompletedRfq } = require('../server/services/rfqExporter');

test('passwords are salted and verified without storing plaintext', async () => {
  const first = await hashPassword('TestPassword123');
  const second = await hashPassword('TestPassword123');
  assert.notEqual(first.hash, second.hash);
  assert.equal(await verifyPassword('TestPassword123', first.salt, first.hash), true);
  assert.equal(await verifyPassword('WrongPassword', first.salt, first.hash), false);
});

test('session tokens are random and stored as hashes', () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.notEqual(first, second);
  assert.equal(hashToken(first).length, 64);
  assert.notEqual(hashToken(first), first);
});

test('standard ONETELECOM RFQ imports six product rows', async t => {
  const workbookPath = process.env.LATIC_STANDARD_RFQ;
  if (!workbookPath) return t.skip('LATIC_STANDARD_RFQ was not provided');
  const result = await importRfqWorkbook(path.resolve(workbookPath));
  assert.equal(result.metadata.requester, 'Angelo Armas');
  assert.equal(result.metadata.country, 'Ecuador');
  assert.equal(result.metadata.client, 'ONETELECOM');
  assert.equal(result.items.length, 6);
  assert.equal(result.items[0].quantity, 1);
  assert.equal(result.items[5].quantity, 40);
});

test('Mexico RFQ with Spanish description header imports correctly', async t => {
  const workbookPath = process.env.LATIC_MEXICO_RFQ;
  if (!workbookPath) return t.skip('LATIC_MEXICO_RFQ was not provided');
  const result = await importRfqWorkbook(path.resolve(workbookPath));
  assert.equal(result.headerRow, 7);
  assert.equal(result.metadata.requester, 'Vanessa');
  assert.equal(result.metadata.client, 'CONSTRUCTORA LA IMAGEN DE HOY');
  assert.equal(result.metadata.requestDate, '2026-07-29');
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].description, /CABLE UTP CAT 6A/i);
  assert.equal(result.items[0].quantity, 770);
  assert.equal(result.items[0].unit, 'BOBINAS');
});

test('completed task exports FOB, RMB total and notes next to the original Mexico RFQ', async t => {
  const workbookPath = process.env.LATIC_MEXICO_RFQ;
  if (!workbookPath) return t.skip('LATIC_MEXICO_RFQ was not provided');
  const outputPath = path.join(os.tmpdir(), `latic-rfq-export-${Date.now()}.xlsx`);
  t.after(() => { try { fs.unlinkSync(outputPath); } catch (_) {} });
  const result = await exportCompletedRfq(path.resolve(workbookPath), outputPath, [{
    lineNo: 1,
    fobUsd: 947.1 / 7.25 / 1.13,
    totalRmb: 947.1,
    remarks: '供应商测试备注',
    attachments: []
  }]);
  // The three output columns must immediately follow the last real source header.
  assert.deepEqual(result.columns, { fobUsd: 16, totalRmb: 17, remarks: 18 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(outputPath);
  const sheet = workbook.getWorksheet('Sheet1');
  assert.equal(sheet.getCell('P7').value, 'FOB');
  assert.equal(sheet.getCell('Q7').value, '总价');
  assert.equal(sheet.getCell('R7').value, '备注');
  assert.equal(sheet.getCell('Q8').value, 947.1);
  assert.equal(sheet.getCell('R8').value, '供应商测试备注');
  assert.ok(Math.abs(sheet.getCell('P8').value - 115.6057) < 0.001);
});
