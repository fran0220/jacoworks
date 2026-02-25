---
name: document-processing
display-name: 文档处理
display-description: 文档格式转换与内容提取
display-group: 办公
description: "Read, create, and modify office documents (Word, Excel, PDF, CSV). Use when the user asks to read, summarize, create, generate, modify, or analyze .docx, .xlsx, .xls, .pdf, .csv, or .tsv files."
---

# Document Processing Skill

Process office documents by writing and executing Node.js scripts. The following npm packages are pre-installed in the agent runtime and available via `import` in `.mjs` scripts.

**Workflow:** write script → `bash node script.mjs` → output file in workspace.

## Available Packages

| Package | Read | Write | Formats |
|---------|------|-------|---------|
| `mammoth` | ✅ | — | .docx → text/html/markdown |
| `docx` | — | ✅ | Create .docx (paragraphs, tables, images, comments, headers/footers, styles) |
| `exceljs` | ✅ | ✅ | .xlsx/.xls/.csv — full read/write with formatting, formulas, charts |
| `pdf-lib` | ✅ (modify) | ✅ | .pdf — create, edit, merge, fill forms, embed images/fonts |
| `pdf-parse` | ✅ | — | .pdf → text extraction by page |
| `csv-parse` | ✅ | — | .csv/.tsv → structured data |

## Script Rules

- **ESM only**: use `import`, file extension `.mjs`
- **Output**: place files in the user's workspace directory
- **Cleanup**: delete the `.mjs` script after successful execution
- **Errors**: wrap in try/catch, `console.error()` for diagnostics
- **Large data**: for 1000+ rows, stream or batch; don't build entire dataset in memory

---

## READ Patterns

### Read Word (.docx)

```javascript
import mammoth from 'mammoth';

// Text extraction (fastest, for summarizing/searching)
const { value } = await mammoth.extractRawText({ path: "input.docx" });
console.log(value);

// Markdown (preserves headings, lists, tables)
const md = await mammoth.convertToMarkdown({ path: "input.docx" });
console.log(md.value);

// HTML (exact formatting)
const html = await mammoth.convertToHtml({ path: "input.docx" });
console.log(html.value);
```

### Read Excel (.xlsx)

```javascript
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("input.xlsx");

// List sheets
console.log("Sheets:", wb.worksheets.map(ws => ws.name).join(", "));

// Read first sheet as table
const ws = wb.worksheets[0];
ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
  const vals = [];
  row.eachCell({ includeEmpty: true }, cell => {
    vals.push(cell.value instanceof Date ? cell.value.toISOString().split('T')[0] : String(cell.value ?? ''));
  });
  console.log(vals.join(" | "));
});
```

### Read PDF (.pdf)

```javascript
import { readFileSync } from 'node:fs';

// pdf-parse v2 API
const { PDFParse } = await import('pdf-parse');
const buffer = readFileSync("input.pdf");
const pdf = new PDFParse({ data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) });
const result = await pdf.getText();
for (const page of result.pages) {
  console.log(`--- Page ${page.pageNumber} ---`);
  console.log(page.text);
}
await pdf.destroy();
```

### Read CSV/TSV

```javascript
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const raw = readFileSync("input.csv", "utf-8");
const records = parse(raw, { columns: true, skip_empty_lines: true });
console.log(JSON.stringify(records.slice(0, 10), null, 2)); // preview first 10 rows
```

---

## WRITE Patterns

### Create Word (.docx)

```javascript
import { Document, Packer, Paragraph, TextRun, HeadingLevel,
         Table, TableRow, TableCell, WidthType,
         Comment, CommentRangeStart, CommentRangeEnd } from 'docx';
import { writeFileSync } from 'node:fs';

const doc = new Document({
  // Optional: comments
  comments: { children: [
    new Comment({ id: 0, author: "Reviewer", date: new Date(),
      children: [new Paragraph("批注内容")] })
  ]},
  sections: [{
    children: [
      // Heading
      new Paragraph({ heading: HeadingLevel.HEADING_1,
        children: [new TextRun("报告标题")] }),
      // Body with comment annotation
      new Paragraph({ children: [
        new CommentRangeStart(0),
        new TextRun({ text: "需要审核的内容", bold: true }),
        new CommentRangeEnd(0),
      ]}),
      // Table
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [
            new TableCell({ children: [new Paragraph("列A")] }),
            new TableCell({ children: [new Paragraph("列B")] }),
          ]}),
        ],
      }),
    ],
  }],
});
writeFileSync("output.docx", await Packer.toBuffer(doc));
console.log("Created output.docx");
```

### Create Excel (.xlsx)

```javascript
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Sheet1');

// Columns
ws.columns = [
  { header: '月份', key: 'month', width: 12 },
  { header: '收入', key: 'income', width: 15 },
  { header: '支出', key: 'expense', width: 15 },
];

// Data
ws.addRows([
  { month: '1月', income: 50000, expense: 30000 },
  { month: '2月', income: 65000, expense: 35000 },
]);

// Formatting
ws.getRow(1).font = { bold: true };
ws.getCell('B3').value = { formula: 'SUM(B2:B3)' };

// Conditional formatting
ws.addConditionalFormatting({
  ref: 'B2:B100',
  rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: [60000],
    style: { font: { color: { argb: 'FF00AA00' } } } }],
});

await wb.xlsx.writeFile('output.xlsx');
console.log("Created output.xlsx");
```

### Modify existing Excel

```javascript
import ExcelJS from 'exceljs';

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("existing.xlsx");
const ws = wb.getWorksheet('Sheet1');

// Add new column
const colCount = ws.columnCount + 1;
ws.getCell(1, colCount).value = '新列';
ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
  if (rowNum > 1) row.getCell(colCount).value = '数据';
});

await wb.xlsx.writeFile("existing.xlsx"); // overwrite
console.log("Modified existing.xlsx");
```

### Create PDF

```javascript
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync } from 'node:fs';

const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]); // A4
const font = await pdf.embedFont(StandardFonts.Helvetica);

page.drawText('Report Title', { x: 50, y: 780, size: 24, font });
page.drawText('Body text here', { x: 50, y: 740, size: 12, font });
page.drawLine({ start: { x: 50, y: 730 }, end: { x: 545, y: 730 },
  thickness: 1, color: rgb(0.7, 0.7, 0.7) });

writeFileSync('output.pdf', await pdf.save());
console.log("Created output.pdf");
```

### Merge PDFs

```javascript
import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

const merged = await PDFDocument.create();
for (const file of ['a.pdf', 'b.pdf', 'c.pdf']) {
  const src = await PDFDocument.load(readFileSync(file));
  const pages = await merged.copyPages(src, src.getPageIndices());
  pages.forEach(p => merged.addPage(p));
}
writeFileSync('merged.pdf', await merged.save());
console.log("Merged into merged.pdf");
```

### Fill PDF Form

```javascript
import { PDFDocument } from 'pdf-lib';
import { readFileSync, writeFileSync } from 'node:fs';

const pdf = await PDFDocument.load(readFileSync('form.pdf'));
const form = pdf.getForm();
form.getTextField('name').setText('张三');
form.getTextField('date').setText('2026-02-24');
form.flatten(); // make fields non-editable
writeFileSync('filled.pdf', await pdf.save());
console.log("Filled form.pdf → filled.pdf");
```

### Write CSV

```javascript
import { writeFileSync } from 'node:fs';

const header = ['名称', '数量', '单价'];
const rows = [['产品A', 100, 25.5], ['产品B', 200, 18.0]];
const csv = [header, ...rows].map(r => r.join(',')).join('\n');
writeFileSync('output.csv', '\uFEFF' + csv, 'utf-8'); // BOM for Excel CJK
console.log("Created output.csv");
```

---

## Common Workflows

### Summarize a document
1. Read with mammoth/pdf-parse script, capture console output
2. Analyze and summarize the content

### Convert formats
1. Read source (e.g., mammoth → markdown)
2. Write target (e.g., PDFDocument → pdf)

### Analyze spreadsheet
1. Read with exceljs script, output as JSON/table
2. Reason about data or write analysis script

### Template-based generation
1. Read template/source document to understand structure
2. Write generation script with data populated

### Batch processing
1. Use `ls` or `find` to list files
2. Write a script that loops over files and processes each

## Limitations
- **Word Track Changes**: not supported (neither read nor write)
- **Word Mail Merge**: not supported
- **PDF CJK text**: StandardFonts don't include CJK — embed a .ttf font file or use docx/xlsx instead
- **Scanned PDFs**: pdf-parse returns empty text for image-only PDFs
