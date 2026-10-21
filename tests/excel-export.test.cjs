const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ExcelJS = require('exceljs');
const exportsUnderTest = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/excel-export.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText, { exports: exportsUnderTest, require, Date });

test('Excel roundtrip preserves phone text, literal customer names, and numeric amounts', async () => {
  const buffer = await exportsUnderTest.buildExcelReport('Customers', [
    { header: 'Customer', width: 30 }, { header: 'Phone', width: 22 },
    { header: 'Total', width: 18, format: '#,##0.00' },
  ], [['=1+1', '09123456789', 1250.5]]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Customers');
  assert.equal(sheet.getCell('A5').value, '=1+1');
  assert.equal(sheet.getCell('A5').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('B5').value, '09123456789');
  assert.equal(sheet.getCell('C5').value, 1250.5);
  assert.equal(sheet.getCell('C5').numFmt, '#,##0.00');
  assert.equal(sheet.pageSetup.paperSize, 9);
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  assert.equal(sheet.pageSetup.fitToHeight, 0);
  assert.equal(sheet.pageSetup.printTitlesRow, '1:4');
  assert.equal(sheet.pageSetup.printArea, 'A1:C5');
});

test('wide orders export uses landscape printing', async () => {
  const buffer = await exportsUnderTest.buildExcelReport('Orders', Array.from({ length: 10 }, (_, i) => ({ header: `Column ${i}`, width: 18 })), []);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.getWorksheet('Orders').pageSetup.orientation, 'landscape');
});
