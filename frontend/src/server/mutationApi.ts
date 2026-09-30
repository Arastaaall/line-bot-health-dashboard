import type { RequestContext } from './context.ts';
import type { ApiResult } from './types.ts';
import { dispatchBodyMutation } from './bodyMutation.ts';
import { fail } from './mutationCommon.ts';
import { dispatchTrainingMutation } from './trainingMutation.ts';

export const VERCEL_MUTATION_ACTIONS = new Set([
  'createTrainingMenu', 'updateTrainingMenu', 'updateTrainingMenuOrder', 'deleteTrainingMenu',
  'createTrainingLog', 'createTrainingLogsBatch', 'updateTrainingLog', 'deleteTrainingLog',
  'createBodyCompositionLog', 'deleteBodyCompositionLog',
]);

export function isMutationAction(action: string): boolean {
  return VERCEL_MUTATION_ACTIONS.has(action);
}

export async function dispatchMutation(
  context: RequestContext,
  userId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<ApiResult<unknown>> {
  if (action.startsWith('createTraining') || action.startsWith('updateTraining') || action.startsWith('deleteTraining')) {
    return dispatchTrainingMutation(context, userId, action, params);
  }
  if (action.startsWith('createBodyComposition') || action.startsWith('deleteBodyComposition')) {
    return dispatchBodyMutation(context, userId, action, params);
  }
  return fail('NOT_FOUND', `Unknown mutation action: ${action}`);
}
