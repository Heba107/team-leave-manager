export type Cell = string | number;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: Cell): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCSV(filename: string, rows: Cell[][]) {
  // Leading BOM makes Excel open UTF-8 (e.g. Arabic names) correctly.
  const body = "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  download(filename, body, "text/csv;charset=utf-8");
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Excel workbook in SpreadsheetML 2003 format: supports multiple sheets, numeric
 * cells and a bold header row with no extra dependencies. Opens in Excel,
 * LibreOffice and Numbers.
 */
export function exportExcel(filename: string, sheets: Sheet[]) {
  const sheetXml = sheets
    .map((sheet) => {
      const rows = sheet.rows
        .map((row, i) => {
          const cells = row
            .map((v) => {
              const type = typeof v === "number" ? "Number" : "String";
              const style = i === 0 ? ' ss:StyleID="h"' : "";
              return `<Cell${style}><Data ss:Type="${type}">${xml(String(v))}</Data></Cell>`;
            })
            .join("");
          return `<Row>${cells}</Row>`;
        })
        .join("");
      const name = xml(sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
      return `<Worksheet ss:Name="${name}"><Table>${rows}</Table></Worksheet>`;
    })
    .join("");
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/></Style></Styles>` +
    sheetXml +
    `</Workbook>`;
  download(filename, doc, "application/vnd.ms-excel");
}
