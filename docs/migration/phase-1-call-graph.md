# GAS Mutation migration: Phase 1 call graph

Baseline: `236b08f` (`fix: bundle Vercel API with esbuild`)

This document records the call paths observed in the GAS source at the
baseline commit. The GAS implementation remains the compatibility reference;
the migration must not infer behavior from the design document alone.

## Dispatch and authentication

```text
GAS doPost
  -> JSON parse
  -> checkAuth(token)
     -> CacheService user cache
     -> verifyLineToken(token)
        -> LINE /v2/profile
  -> dispatchTraining(userId, action, params)
```

The Vercel migration keeps `checkAuth(token)` before both read and mutation
dispatch. `params.user_id` is not an authentication source.

## Common mutation path

```text
api*Mutation(userId, params)
  -> withLock_
     -> getUserRecord_
        -> getRows(users)
     -> dedupCheck_ / dedupSave_ (where present)
     -> findById / getRows / getTrainingMasterMap_
        -> getTrainingMasterRows_
           -> cached_(Training_Master)
           -> getRows(Training_Master, is_active)
        -> getMasterDefaults_
           -> active master map
           -> findById(Training_Master) inactive fallback
     -> appendRowObj / appendRowsObjs / updateRowById / delete*
     -> cache invalidation (GAS-only; not migrated as a correctness feature)
```

## Training Menu

```text
createTrainingMenu
  -> withLock_
  -> dedupCheck_
  -> getUserRecord_
  -> getRows(Training_Menus, user_id + is_active) [free limit: 5]
  -> getMasterDefaults_ [when master_id is supplied]
  -> deriveInputProfile_
  -> getRows(Training_Menus, user_id) [display_order]
  -> appendRowObj(Training_Menus)
  -> dedupSave_

updateTrainingMenu
  -> withLock_
  -> findById(Training_Menus)
  -> ownership check
  -> partial patch: display_order/menu_name/training_group/updated_at
  -> updateRowById

updateTrainingMenuOrder
  -> withLock_
  -> getRows(Training_Menus, user_id + requested ids)
  -> require every requested id to be owned
  -> sheetValues + per-row writes

deleteTrainingMenu
  -> withLock_
  -> findById(Training_Menus)
  -> ownership check
  -> soft delete: is_active=false, updated_at
```

## Training Log

```text
createTrainingLog
  -> withLock_ -> dedupCheck_ -> getUserRecord_
  -> dateKeyOf_ / todayKey_ [free daily limit: 7]
  -> validateTrainingLogBase_ -> validateSets_
  -> menu ownership/name/master resolution
  -> getMasterDefaults_ [active map, inactive fallback]
  -> resolveRpe_
  -> calculateCardioCalories OR calculateStrengthCalories
  -> appendRowObj(Training_Logs)
  -> appendRowsObjs(Training_Sets)
  -> dedupSave_

createTrainingLogsBatch
  -> withLock_ -> dedupCheck_ -> getUserRecord_
  -> todayKey_ + existing count + input count [free limit: 7]
  -> for each entry:
       validateTrainingLogBase_ -> validateSets_
       menu/master resolution -> resolveRpe_
       calculate calories -> append log -> append sets
  -> return partial-success result
  -> dedupSave_ only when every entry succeeds

updateTrainingLog
  -> withLock_ -> findById(Training_Logs) -> ownership check
  -> patch editable fields and resolveRpe_ when supplied
  -> validateSets_ only when sets are supplied
  -> get existing sets when sets are omitted
  -> recalculate calories
  -> updateRowById(Training_Logs)
  -> when sets supplied: deleteRowsByForeignKey + appendRowsObjs

deleteTrainingLog
  -> withLock_ -> findById(Training_Logs) -> ownership check
  -> deleteRowsByForeignKey(Training_Sets)
  -> deleteRowById(Training_Logs)
```

## Body Composition

```text
createBodyCompositionLog
  -> withLock_
  -> normalizeMeasuredAt_
  -> validateBodyComposition_
  -> dedupCheck_
  -> appendRowObj(Body_Composition)
  -> syncUserWeight_
     -> getRows(Body_Composition, user_id + non-null weight)
     -> measured_at DESC, created_at DESC
     -> updateRowById(users, weight only)
  -> dedupSave_

deleteBodyCompositionLog
  -> findById(Body_Composition) [baseline check occurs before lock]
  -> ownership check
  -> withLock_
  -> deleteRowById(Body_Composition)
  -> syncUserWeight_
  -> return deleted=true
```

## Helper classification

| Helper / constant group | Migration decision |
| --- | --- |
| `getUserRecord_`, `getMasterDefaults_`, `deriveInputProfile_` | port to Vercel |
| `validateTrainingLogBase_`, `validateSets_`, `resolveRpe_` | port unchanged |
| calorie constants and calculation helpers | port unchanged |
| `normalizeMeasuredAt_`, `validateBodyComposition_`, `syncUserWeight_` | port with explicit JST and partial update |
| `cached_`, `invalidate*Caches_` | GAS-only cache behavior; do not port for correctness |
| `dedupCheck_`, `dedupSave_` | replace with shared idempotency store |
| `withLock_` | replace with spreadsheet-global distributed lock |
| `SpreadsheetApp` row operations | replace with Sheets API write repository |

## Compatibility notes fixed for later phases

- `createTrainingLogsBatch` is partial-success; dedup is saved only when all
  entries succeed.
- `updateTrainingLog` does not call `validateTrainingLogBase_`; only supplied
  sets are validated.
- Missing user weight falls back to `60` kg.
- Missing master MET falls back to `3.5`.
- Active Training Master lookup falls back to an inactive master by ID.
- Duplicate IDs in menu reorder fail because the owned-row count differs from
  the requested ID count.
- Menu delete is a soft delete.

## Phase 0 items not inferable from source

- Whether the root GAS/HTML UI is still used by real users.
- The deployed LIFF Endpoint and Rich Menu target.
- Actual Google Sheet date/datetime cell types.
- Whether the configured Service Account has Editor permission.

These remain explicit release gates and must be confirmed before GAS is
stopped.
