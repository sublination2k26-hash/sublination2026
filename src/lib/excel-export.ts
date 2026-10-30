import { Workbook } from "exceljs";

export type ExportColumn = { header: string; width: number; format?: string };
export type ExportValue = string | number;

export type ExcelReportSheet = { title: string; columns: ExportColumn[]; rows: ExportValue[][]; note?: string };

export async function buildExcelWorkbook(reports: ExcelReportSheet[]) {
  const workbook = new Workbook();
  workbook.creator = "Subli-nation Printing System";
  for (const { title, columns, rows, note } of reports) {
  const sheet = workbook.addWorksheet(title, {
    pageSetup: { paperSize: 9, orientation: columns.length > 5 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 4 }],
  });
  sheet.columns = columns.map(column => ({ width: column.width }));
  sheet.mergeCells(1, 1, 1, columns.length);
  sheet.getCell(1, 1).value = `Subli-nation — ${title}`;
  sheet.getCell(1, 1).font = { size: 16, bold: true };
  sheet.getRow(1).height = 28;
  sheet.mergeCells(2, 1, 2, columns.length);
  sheet.getCell(2, 1).value = `Generated ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Asia/Manila) · ${rows.length} records`;
  if (note) { sheet.mergeCells(3, 1, 3, columns.length); sheet.getCell(3, 1).value = note; sheet.getCell(3, 1).alignment = { wrapText: true }; sheet.getRow(3).height = 30; }
  const header = sheet.getRow(4);
  header.values = columns.map(column => column.header);
  header.height = 30;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF254F46" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  rows.forEach(values => {
    const row = sheet.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, index) => {
      cell.alignment = { vertical: "top", wrapText: true };
      if (columns[index - 1].format) cell.numFmt = columns[index - 1].format!;
      cell.border = { bottom: { style: "hair", color: { argb: "FFD8DFDC" } } };
    });
  });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, sheet.rowCount), column: columns.length } };
  sheet.pageSetup.printTitlesRow = "1:4";
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns.length).letter}${Math.max(4, sheet.rowCount)}`;
  sheet.headerFooter.oddFooter = "&LSubli-nation Printing System&RPage &P of &N";
  }
  return workbook.xlsx.writeBuffer();
}

export async function buildExcelReport(title: string, columns: ExportColumn[], rows: ExportValue[][]) {
  return buildExcelWorkbook([{ title, columns, rows }]);
}
