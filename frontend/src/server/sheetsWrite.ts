import type { RequestContext } from './context.ts';
import { sheetValues, type SheetProperties } from './sheets.ts';
import type { SheetRow, SheetValue } from './types.ts';

type ExtendedValue = { stringValue?: string; numberValue?: number; boolValue?: boolean };

function sheetId(properties: Map<string, SheetProperties>, sheetName: string): number {
  const property = properties.get(sheetName);
  if (!property) throw new Error(`Sheet not found: ${sheetName}`);
  return property.sheetId;
}

function serialDate(value: Date): number {
  return value.getTime() / 86400000 + 25569;
}

// Every string is deliberately sent as stringValue. This prevents a user
// supplied value beginning with "=" from becoming a Sheets formula.
export function extendedValue(value: unknown): ExtendedValue {
  if (value instanceof Date) return { numberValue: serialDate(value) };
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { numberValue: value };
  return { stringValue: value === null || value === undefined ? '' : String(value) };
}

function headerOf(values: SheetValue[][], sheetName: string): string[] {
  if (!values.length) throw new Error(`Sheet has no header: ${sheetName}`);
  return values[0].map((value) => String(value ?? ''));
}

export async function sheetHeader(context: RequestContext, sheetName: string): Promise<string[]> {
  return headerOf(await sheetValues(context, sheetName), sheetName);
}

export async function findRowPosition(
  context: RequestContext,
  sheetName: string,
  idColumn: string,
  idValue: unknown,
): Promise<{ row: SheetRow; rowNumber: number; header: string[] } | null> {
  const values = await sheetValues(context, sheetName);
  const header = headerOf(values, sheetName);
  const idIndex = header.indexOf(idColumn);
  if (idIndex < 0) return null;
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][idIndex] ?? '') !== String(idValue ?? '')) continue;
    const row: SheetRow = {};
    header.forEach((column, columnIndex) => { row[column] = values[index][columnIndex] ?? ''; });
    return { row, rowNumber: index + 1, header };
  }
  return null;
}

export async function rowsByForeignKey(
  context: RequestContext,
  sheetName: string,
  foreignKey: string,
  value: unknown,
): Promise<Array<{ row: SheetRow; rowNumber: number; header: string[] }>> {
  const values = await sheetValues(context, sheetName);
  const header = headerOf(values, sheetName);
  const keyIndex = header.indexOf(foreignKey);
  if (keyIndex < 0) return [];
  const result: Array<{ row: SheetRow; rowNumber: number; header: string[] }> = [];
  for (let index = 1; index < values.length; index += 1) {
    if (String(values[index][keyIndex] ?? '') !== String(value ?? '')) continue;
    const row: SheetRow = {};
    header.forEach((column, columnIndex) => { row[column] = values[index][columnIndex] ?? ''; });
    result.push({ row, rowNumber: index + 1, header });
  }
  return result;
}

export function appendRowsRequest(
  properties: Map<string, SheetProperties>,
  sheetName: string,
  header: string[],
  rows: SheetRow[],
): Record<string, unknown> {
  return {
    appendCells: {
      sheetId: sheetId(properties, sheetName),
      fields: 'userEnteredValue',
      rows: rows.map((row) => ({
        values: header.map((column) => ({ userEnteredValue: extendedValue(row[column]) })),
      })),
    },
  };
}

export function updateCellsRequest(
  properties: Map<string, SheetProperties>,
  sheetName: string,
  rowNumber: number,
  header: string[],
  patch: SheetRow,
): Record<string, unknown>[] {
  const id = sheetId(properties, sheetName);
  return Object.entries(patch).flatMap(([column, value]) => {
    const columnIndex = header.indexOf(column);
    if (columnIndex < 0) return [];
    return [{
      updateCells: {
        start: { sheetId: id, rowIndex: rowNumber - 1, columnIndex },
        fields: 'userEnteredValue',
        rows: [{ values: [{ userEnteredValue: extendedValue(value) }] }],
      },
    }];
  });
}

export function deleteRowsRequest(
  properties: Map<string, SheetProperties>,
  sheetName: string,
  rowNumbers: number[],
): Record<string, unknown>[] {
  const id = sheetId(properties, sheetName);
  return [...rowNumbers].sort((a, b) => b - a).map((rowNumber) => ({
    deleteDimension: {
      range: { sheetId: id, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber },
    },
  }));
}

export async function writeBatch(
  context: RequestContext,
  requests: Record<string, unknown>[],
  touchedSheets: string[],
): Promise<void> {
  if (!requests.length) return;
  await context.sheets.batchUpdate(requests);
  const prefixes = [...new Set(touchedSheets)].map((name) => `${name}::`);
  [...context.sheetMemo.keys()].forEach((key) => {
    if (prefixes.some((prefix) => key.startsWith(prefix))) context.sheetMemo.delete(key);
  });
}

export async function metadata(context: RequestContext): Promise<Map<string, SheetProperties>> {
  return context.sheets.sheetProperties();
}
