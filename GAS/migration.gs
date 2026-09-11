// Phase 3 初期Migration（GASエディタから手動実行専用）
// 注意: measured_at は必ず「Migration実行時刻」。Users.updated_at は使わない。
function migrateUsersWeightToBodyComposition() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const usersSheet = ss.getSheetByName('users');
  const bcSheet = ss.getSheetByName('Body_Composition');
  if (!usersSheet || !bcSheet) {
    Logger.log('ERROR: users or Body_Composition sheet not found');
    return;
  }

  const usersData = usersSheet.getDataRange().getValues();
  const uHeader = usersData[0];
  const uIdIdx = uHeader.indexOf('user_id');
  const uWeightIdx = uHeader.indexOf('weight');

  const bcData = bcSheet.getDataRange().getValues();
  const bHeader = bcData[0];
  const bUserIdx = bHeader.indexOf('user_id');
  const bDeviceIdx = bHeader.indexOf('measurement_device');

  // 冪等性: migration行が既に存在するユーザーはスキップ
  const migrated = {};
  for (let i = 1; i < bcData.length; i++) {
    if (String(bcData[i][bDeviceIdx]) === 'migration') {
      migrated[String(bcData[i][bUserIdx])] = true;
    }
  }

  const now = new Date(); // Migration実行時刻
  let targeted = 0, created = 0, skipped = 0;

  for (let i = 1; i < usersData.length; i++) {
    const userId = String(usersData[i][uIdIdx] || '');
    const rawW = usersData[i][uWeightIdx];
    const w = Number(rawW);

    if (!userId) { skipped++; continue; }
    if (migrated[userId]) { skipped++; continue; }
    if (rawW === '' || rawW === null || rawW === undefined || isNaN(w) || w <= 0) { skipped++; continue; }

    targeted++;
    appendRowObj('Body_Composition', {
      body_log_id: makeId_('bc'),
      user_id: userId,
      measured_at: now,
      measurement_device: 'migration',
      weight_kg: w,
      memo: '初期マイグレーション（Users.weightより自動生成）',
      created_at: nowIso_()
    });
    created++;
  }

  Logger.log('migration complete: targeted=' + targeted + ' created=' + created + ' skipped=' + skipped);
}