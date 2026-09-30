import { SheetsClient } from './sheets.ts';
import { createMutationStore, type MutationStore } from './mutationStore.ts';

export type RequestContext = {
  sheets: SheetsClient;
  sheetMemo: Map<string, Array<Array<string | number | boolean | null>>>;
  sheetPending: Map<string, Promise<Array<Array<string | number | boolean | null>>>>;
  mutationStore: MutationStore;
};

export function createRequestContext(mutationStore: MutationStore = createMutationStore()): RequestContext {
  return { sheets: new SheetsClient(), sheetMemo: new Map(), sheetPending: new Map(), mutationStore };
}
