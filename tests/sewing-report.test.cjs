const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const ExcelJS = require('exceljs');
function load(file, window = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, window, require: name => name === './excel-export' ? load('src/lib/excel-export.ts') : require(name) });
  return exports;
}
const source = {
  tasks: [{id:'t',order_id:'o',order_item_id:'i',stage:'sewing',status:'in_progress'},{id:'t2',order_id:'o2',order_item_id:'i2',stage:'sewing',status:'pending'}],
  orders: [{id:'o',order_number:'JO-1',due_date:'2026-11-01',notes:'Blue jerseys'},{id:'o2',order_number:'JO-2',due_date:null,notes:''}],
  items: [{id:'i',product_name:'Jersey',quantity:20,customization:{names:'S 10, M 10'},notes:'Check seams'},{id:'i2',product_name:'Shorts',quantity:7,customization:{},notes:''}],
  employees: [{id:'s',full_name:'Sewer <script>alert(1)</script>'},{id:'s2',full_name:'Sewer B'},{id:'f',full_name:'Front Desk & Owner'}],
  assignments: [{id:'a',task_id:'t',employee_id:'s',quantity:12,assigned_by:'f',notes:'Bundle A',created_at:'2026-10-28T16:00:00Z'},
    {id:'b',task_id:'t',employee_id:'s2',quantity:8,assigned_by:'f',notes:'Bundle B',created_at:'2026-10-29T02:00:00Z'},
    {id:'c',task_id:'t2',employee_id:'s',quantity:7,assigned_by:'f',notes:'Second order',created_at:'2026-10-29T03:00:00Z'}],
  events: [{id:'e2',assignment_id:'a',kind:'completion',quantity:3,recorded_by:'s',notes:'First output',created_at:'2026-10-29T04:00:00Z'},
    {id:'e1',assignment_id:'a',kind:'handoff',quantity:10,recorded_by:'f',notes:'Materials',created_at:'2026-10-29T03:00:00Z'},
    {id:'e3',assignment_id:'a',kind:'completion',quantity:4,recorded_by:'s',notes:'Second output',created_at:'2026-10-29T05:00:00Z'},
    {id:'e4',assignment_id:'a',kind:'rework',quantity:2,recorded_by:'s',notes:'<img src=x onerror=alert(1)>',created_at:'2026-10-29T06:00:00Z'}],
};
test('sewing report reconciles partial output, separate sewers, recorders and filters without counting rework as new output', () => {
  const {buildSewingReport} = load('src/lib/sewing-report.ts');
  const report = buildSewingReport(source,'o');
  assert.equal(report.summaries.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(report.totals)),{assigned:20,handed:10,completed:7,remaining:13,rework:2});
  const first=report.summaries[0];
  assert.equal(first.waiting,2); assert.equal(first.ready,3); assert.equal(first.remaining,5);
  assert.equal(first.assignedBy,'Front Desk & Owner'); assert.equal(first.recordedBy,source.employees[0].full_name);
  assert.equal(first.events[0].kind,'Assignment'); assert.equal(first.events[1].kind,'Materials handoff');
  assert.ok(first.assignedAt.includes('10/29/2026'), 'uses Philippine date across UTC midnight');
  assert.equal(buildSewingReport(source,'o','s2').totals.completed,0);
  assert.equal(buildSewingReport(source,'','s').totals.assigned,19);
  assert.equal(buildSewingReport(source,'missing').summaryRows.length,0);
  assert.equal(source.events[0].id,'e2','does not mutate source event order');
});
test('sewing Excel preserves numeric completed quantities and full recording history with printable headers', async () => {
  const {buildSewingReport,sewingSummaryColumns,sewingHistoryColumns}=load('src/lib/sewing-report.ts');
  const {buildExcelReport}=load('src/lib/excel-export.ts');
  const report=buildSewingReport(source,'o','s');
  for(const [title,columns,rows] of [['Sewing output summary',sewingSummaryColumns,report.summaryRows],['Sewing recording history',sewingHistoryColumns,report.historyRows]]) {
    // ExcelJS expects host-realm arrays; transpiled helpers run in isolated VM contexts here.
    const book=new ExcelJS.Workbook(); await book.xlsx.load(await buildExcelReport(title,JSON.parse(JSON.stringify(columns)),JSON.parse(JSON.stringify(rows))));
    const sheet=book.worksheets[0];
    assert.equal(sheet.pageSetup.orientation,'landscape'); assert.equal(sheet.pageSetup.printTitlesRow,'1:4');
    assert.equal(sheet.getCell(5,3).value,source.employees[0].full_name);
    if(title==='Sewing output summary') { assert.equal(sheet.getCell(5,8).value,7); assert.equal(typeof sheet.getCell(5,8).value,'number'); }
    else { assert.equal(sheet.rowCount,9); assert.equal(sheet.getCell(5,6).value,'Front Desk & Owner'); }
  }
});
test('sewing print includes assignment and recorder details, escapes text, and handles blocked popups', () => {
  const tools=load('src/lib/sewing-report.ts');
  const report=tools.buildSewingReport(source,'o','s');
  const html=tools.sewingReportPrintHtml(report);
  assert.ok(html.includes('Completed: 7')); assert.ok(html.includes('Front Desk &amp; Owner'));
  assert.ok(html.includes('S 10, M 10')); assert.ok(html.includes('Bundle A'));
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('display:table-header-group'));
  assert.throws(()=>load('src/lib/sewing-report.ts',{open:()=>null}).printSewingReport(report),/Allow pop-ups/);
  let printed=false,written='';
  const preview={opener:{},focus(){},print(){printed=true},document:{open(){},write(value){written=value},close(){}}};
  load('src/lib/sewing-report.ts',{open:()=>preview}).printSewingReport(report);
  assert.equal(printed,true); assert.equal(preview.opener,null); assert.ok(written.includes('Sewing output report'));
});

test('complete sewing workbook includes every sewer total, order breakdown and detailed recorded activity', async () => {
  const tools=load('src/lib/sewing-report.ts');
  const report=tools.buildSewingReport(source);
  const book=new ExcelJS.Workbook();
  await book.xlsx.load(await tools.buildCompleteSewingExcel(JSON.parse(JSON.stringify(report))));
  assert.deepEqual(book.worksheets.map(sheet=>sheet.name),['Sewer totals','Order breakdown','Activity history']);
  const totals=book.getWorksheet('Sewer totals');
  assert.equal(totals.rowCount,6,'one total row per employee across all orders');
  const sewerRow=[totals.getRow(5),totals.getRow(6)].find(row=>row.getCell(8).value==='s');
  assert.equal(sewerRow.getCell(2).value,2,'distinct orders');
  assert.equal(sewerRow.getCell(3).value,19,'all reserved pieces across orders');
  assert.equal(sewerRow.getCell(5).value,7,'actual completed quantity excludes rework');
  assert.equal(sewerRow.getCell(6).value,12);
  assert.equal(sewerRow.getCell(7).value,2);
  assert.equal(book.getWorksheet('Order breakdown').rowCount,7);
  assert.equal(book.getWorksheet('Activity history').rowCount,11);
  for(const sheet of book.worksheets) {
    assert.equal(sheet.pageSetup.orientation,'landscape');
    assert.equal(sheet.pageSetup.printTitlesRow,'1:4');
    assert.ok(sheet.getCell(3,1).value.includes('Rework is separate'));
  }
  const sameNames=tools.buildSewingReport({...source,employees:source.employees.map(person=>({...person,full_name:'Same name'}))});
  assert.equal(sameNames.sewerRows.length,2,'employees with identical names are not merged');
});

test('team names appear in sewing screens, exports and print while preserving JO numbers', () => {
  const tools=load('src/lib/sewing-report.ts');
  const named={...source,customers:[{id:'team',full_name:'Dale <Team>'}],orders:source.orders.map(order=>({...order,customer_id:'team'}))};
  const report=tools.buildSewingReport(named);
  assert.equal(report.summaries[0].team,'Dale <Team>');
  assert.ok(report.summaryRows.every(row=>row[0].startsWith('Dale <Team> / JO-')));
  assert.ok(report.historyRows.every(row=>row[0].startsWith('Dale <Team> / JO-')));
  const html=tools.sewingReportPrintHtml(report);
  assert.ok(html.includes('Dale &lt;Team&gt; / JO-'));
  assert.ok(!html.includes('Dale <Team>'));
});
