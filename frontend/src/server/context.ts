import { SheetsClient } from './sheets.ts';

export type RequestContext = {
  sheets: SheetsClient;
  sheetMemo: Map<string, Array<Array<string | number | boolean | null>>>;
  sheetPending: Map<string, Promise<Array<Array<string | number | boolean | null>>>>;
};

export function createRequestContext(): RequestContext {
  return { sheets: new SheetsClient(), sheetMemo: new Map(), sheetPending: new Map() };
}
