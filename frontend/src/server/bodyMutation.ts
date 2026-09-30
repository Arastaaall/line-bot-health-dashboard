import type { RequestContext } from './context.ts';
import { appendRowsRequest, deleteRowsRequest, findRowPosition, metadata, updateCellsRequest, writeBatch } from './sheetsWrite.ts';
import { sheetValues } from './sheets.ts';
import type { ApiResult, SheetRow, SheetValue } from './types.ts';
import { asDate, cellNumber, dedupGet, dedupSave, fail, normalizeMeasuredAt, notFound, nowIso, numberValue, ok, text, validateBodyComposition, withMutationLock } from './mutationCommon.ts';

function rowsFromValues(values: SheetValue[][]): SheetRow[] {
  if (values.length < 2) return [];
  const header = values[0].map((value) => String(value ?? ''));
  return values.slice(1).map((valuesRow) => Object.fromEntries(header.map((column, index) => [column, valuesRow[index] ?? ''])));
}

function latestWeight(rows: SheetRow[], userId: string, excludedId = ''): number | null {
  const candidates = rows.filter((row) => text(row, 'user_id') === userId && text(row, 'body_log_id') !== excludedId && numberValue(row.weight_kg) !== null);
  candidates.sort((left, right) => {
    const measured = asDate(right.measured_at).getTime() - asDate(left.measured_at).getTime();
    return measured || (asDate(right.created_at).getTime() - asDate(left.created_at).getTime());
  });
  return candidates.length ? numberValue(candidates[0].weight_kg) : null;
}

async function serialBodyRows(context: RequestContext): Promise<SheetRow[]> {
  return rowsFromValues(await sheetValues(context, 'Body_Composition', { dateTimeRenderOption: 'SERIAL_NUMBER' }));
}

async function userWeightPatch(context: RequestContext, userId: string, weight: number | null): Promise<Record<string, unknown>[]> {
  if (weight === null) return [];
  const user = await findRowPosition(context, 'users', 'user_id', userId);
  if (!user) return [];
  const properties = await metadata(context);
  return updateCellsRequest(properties, 'users', user.rowNumber, user.header, { weight });
}

function bodyRow(userId: string, params: Record<string, unknown>, id: string, measuredAt: Date, now: string): SheetRow {
  return {
    body_log_id: id,
    user_id: userId,
    measured_at: measuredAt,
    measurement_device: params.measurement_device,
    weight_kg: numberValue(params.weight_kg),
    body_fat_pct: cellNumber(params.body_fat_pct),
    skeletal_muscle_kg: cellNumber(params.skeletal_muscle_kg),
    muscle_mass_kg: cellNumber(params.muscle_mass_kg),
    body_water_pct: cellNumber(params.body_water_pct),
    visceral_fat: cellNumber(params.visceral_fat),
    bmr: cellNumber(params.bmr),
    waist_cm: cellNumber(params.waist_cm),
    other_data: params.other_data || '',
    memo: params.memo || '',
    created_at: now,
  };
}

export async function createBodyCompositionLog(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const measuredAt = normalizeMeasuredAt(params.measured_at);
    const errors = validateBodyComposition(params);
    if (!measuredAt) errors.push('measured_atの形式が不正です');
    if (errors.length) return fail('VALIDATION_ERROR', errors.join(' / '));
    if (!measuredAt) return fail('VALIDATION_ERROR', 'measured_atの形式が不正です');
    const duplicate = await dedupGet(context, userId, 'createBodyCompositionLog', params.client_id);
    if (duplicate) return duplicate;
    const id = `bc_${crypto.randomUUID()}`;
    const now = nowIso();
    const row = bodyRow(userId, params, id, measuredAt, now);
    const rows = await serialBodyRows(context);
    rows.push(row);
    const weight = latestWeight(rows, userId);
    const [properties, header] = await Promise.all([metadata(context), context.sheets.values('Body_Composition').then((values) => values[0].map((value) => String(value ?? '')))]);
    const requests = [appendRowsRequest(properties, 'Body_Composition', header, [row])];
    requests.push(...await userWeightPatch(context, userId, weight));
    await writeBatch(context, requests, ['Body_Composition', 'users']);
    const result = ok({ body_log_id: id });
    await dedupSave(context, userId, 'createBodyCompositionLog', params.client_id, result);
    return result;
  });
}

export async function deleteBodyCompositionLog(context: RequestContext, userId: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  return withMutationLock(context, async () => {
    const found = await findRowPosition(context, 'Body_Composition', 'body_log_id', params.body_log_id);
    if (!found || text(found.row, 'user_id') !== userId) return notFound('記録が見つかりません');
    const rows = await serialBodyRows(context);
    const weight = latestWeight(rows, userId, String(params.body_log_id));
    const properties = await metadata(context);
    const requests = deleteRowsRequest(properties, 'Body_Composition', [found.rowNumber]);
    requests.push(...await userWeightPatch(context, userId, weight));
    await writeBatch(context, requests, ['Body_Composition', 'users']);
    return ok({ deleted: true });
  });
}

export function dispatchBodyMutation(context: RequestContext, userId: string, action: string, params: Record<string, unknown>): Promise<ApiResult<unknown>> {
  switch (action) {
    case 'createBodyCompositionLog': return createBodyCompositionLog(context, userId, params);
    case 'deleteBodyCompositionLog': return deleteBodyCompositionLog(context, userId, params);
    default: return Promise.resolve(fail('NOT_FOUND', `Unknown mutation action: ${action}`));
  }
}
