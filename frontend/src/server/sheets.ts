import { createSign } from 'node:crypto';
import type { RequestContext } from './context.ts';
import type { SheetRow, SheetValue } from './types.ts';

type GoogleValuesResponse = { values?: SheetValue[][] };
type GoogleBatchValuesResponse = { valueRanges?: Array<{ values?: SheetValue[][] }> };

let accessToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function serviceAccountPrivateKey(): string {
  return requiredEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
}

async function getGoogleAccessToken(): Promise<string> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60000) return accessToken.value;

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claim = base64Url(JSON.stringify({
    iss: requiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccountPrivateKey()))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  if (!response.ok) throw new Error('Google authentication failed');
  const json = await response.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Google authentication returned no access token');
  accessToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

function sheetRange(sheetName: string): string {
  // Quoting the sheet name keeps names containing spaces or punctuation valid.
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export class SheetsClient {
  private readonly spreadsheetId: string;

  constructor() {
    this.spreadsheetId = requiredEnv('GOOGLE_SPREADSHEET_ID');
  }

  async values(sheetName: string): Promise<SheetValue[][]> {
    const token = await getGoogleAccessToken();
    const query = new URLSearchParams({
      majorDimension: 'ROWS',
      // Preserve GAS getValues() number/boolean types while keeping date cells
      // readable instead of exposing Sheets' serial-date numbers.
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(sheetRange(sheetName))}?${query}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Google Sheets read failed');
    const json = await response.json() as GoogleValuesResponse;
    return json.values ?? [[]];
  }

  async batchValues(sheetNames: string[]): Promise<Map<string, SheetValue[][]>> {
    const token = await getGoogleAccessToken();
    const query = new URLSearchParams({
      majorDimension: 'ROWS',
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    sheetNames.forEach((sheetName) => query.append('ranges', sheetRange(sheetName)));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values:batchGet?${query}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Google Sheets batch read failed');
    const json = await response.json() as GoogleBatchValuesResponse;
    const result = new Map<string, SheetValue[][]>();
    sheetNames.forEach((sheetName, index) => {
      result.set(sheetName, json.valueRanges?.[index]?.values ?? [[]]);
    });
    return result;
  }
}

export async function sheetValues(context: RequestContext, sheetName: string): Promise<SheetValue[][]> {
  const cached = context.sheetMemo.get(sheetName);
  if (cached) return cached;
  const pending = context.sheetPending.get(sheetName);
  if (pending) return pending;

  const request = context.sheets.values(sheetName);
  context.sheetPending.set(sheetName, request);
  try {
    const values = await request;
    context.sheetMemo.set(sheetName, values);
    return values;
  } finally {
    context.sheetPending.delete(sheetName);
  }
}

export async function batchSheetValues(context: RequestContext, sheetNames: string[]): Promise<Map<string, SheetValue[][]>> {
  const names = [...new Set(sheetNames)];
  const missing = names.filter((name) => !context.sheetMemo.has(name) && !context.sheetPending.has(name));
  if (missing.length) {
    const batch = context.sheets.batchValues(missing);
    missing.forEach((name) => {
      const pending = batch.then((values) => {
        const result = values.get(name) ?? [[]];
        context.sheetMemo.set(name, result);
        return result;
      }).finally(() => {
        context.sheetPending.delete(name);
      });
      context.sheetPending.set(name, pending);
    });
  }

  const result = new Map<string, SheetValue[][]>();
  await Promise.all(names.map(async (name) => {
    result.set(name, await sheetValues(context, name));
  }));
  return result;
}

export async function getRows(context: RequestContext, sheetName: string, filter?: (row: SheetRow) => boolean): Promise<SheetRow[]> {
  const values = await sheetValues(context, sheetName);
  if (values.length < 2) return [];
  const header = values[0].map((value) => String(value ?? ''));
  const rows: SheetRow[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const row: SheetRow = {};
    for (let column = 0; column < header.length; column += 1) row[header[column]] = values[index][column] ?? '';
    if (!filter || filter(row)) rows.push(row);
  }
  return rows;
}

export async function findById(context: RequestContext, sheetName: string, idColumn: string, idValue: unknown): Promise<SheetRow | null> {
  const rows = await getRows(context, sheetName, (row) => String(row[idColumn] ?? '') === String(idValue ?? ''));
  return rows[0] ?? null;
}
