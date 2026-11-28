const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function downloadFile(content: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadWorkbook(rows: (string|null)[][], sheetName: string, filename: string) {
  const {utils,write} = await import('xlsx');
  const workbook = utils.book_new();
  // Keep identifiers and formula-looking text as literal strings.
  utils.book_append_sheet(workbook,utils.aoa_to_sheet(rows.map(row=>row.map(cell=>cell??''))),sheetName);
  downloadFile(write(workbook,{bookType:'xlsx',type:'array',compression:true}) as ArrayBuffer,excelMime,filename);
}

export async function readLeadWorkbook(bytes: ArrayBuffer) {
  const {read,utils,SSF} = await import('xlsx');
  const workbook = read(bytes,{type:'array',sheets:0,sheetRows:252,cellNF:true});
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) throw new Error('The first worksheet is empty.');
  const range = utils.decode_range(sheet['!fullref']??sheet['!ref']);
  if (range.e.r-range.s.r>250 || range.e.c-range.s.c>60) {
    throw new Error('Include at most 250 data rows and 61 columns in the first worksheet.');
  }
  const data: string[][] = [];
  const formulas = new Set<number>();
  for (let row=range.s.r; row<=range.e.r; row++) {
    const values: string[] = [];
    for (let column=range.s.c; column<=range.e.c; column++) {
      const cell = sheet[utils.encode_cell({r:row,c:column})];
      if (cell?.f || cell?.F) formulas.add(row-range.s.r);
      const value: unknown = cell?.v;
      const date=typeof value==='number'&&typeof cell?.z==='string'&&SSF.is_date(cell.z)
        ? SSF.parse_date_code(value,{date1904:workbook.Workbook?.WBProps?.date1904===true}) : null;
      const pad=(part:number,width=2)=>String(part).padStart(width,'0');
      values.push(date?`${pad(date.y,4)}-${pad(date.m)}-${pad(date.d)}T${pad(date.H)}:${pad(date.M)}:${pad(date.S)}+05:30`
        : typeof value==='string'||typeof value==='number' ? String(value) : '');
    }
    data.push(values);
  }
  if (formulas.has(0)) throw new Error('Use plain text column headers.');
  return {data,formulas,firstRow:range.s.r+1};
}
