// ==========================================
// 栄養管理ダッシュボード GAS API
// 構成メモ(将来のファイル分割用):
//   utils / auth / main / api_dashboard
// ==========================================

// ---------- utils ----------
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ok_(data) { return jsonResponse_({ ok: true, data: data }); }
function fail_(code, message) {
  return jsonResponse_({ ok: false, error: { code: code, message: message } });
}
function legacyError_(message) { return jsonResponse_({ error: message }); }

// ---------- auth ----------
function verifyLineToken(token) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
      method: 'get',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText()).userId;
  } catch (err) {
    return null;
  }
}

// ---------- main: doGet ----------
function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : '';

  if (action === 'health') {
    return ok_({ status: 'ok', time: new Date().toISOString() });
  }
  if (action === 'config') {
    const props = PropertiesService.getScriptProperties();
    return jsonResponse_({ LIFF_ID: props.getProperty('LIFF_ID') });
  }
  // レガシー: 旧index.html用HTML配信
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('栄養管理ダッシュボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------- main: doPost (action dispatcher) ----------
function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents || '{}');
  } catch (err) {
    return fail_('VALIDATION_ERROR', 'リクエスト形式が不正です');
  }

  const token = req.token;
  const action = req.action || '';
  const isLegacy = (action === '');

  if (!token) {
    return isLegacy ? legacyError_('Token is required')
                    : fail_('AUTH_FAILED', 'Token is required');
  }

  const userId = verifyLineToken(token);
  if (!userId) {
    return isLegacy ? legacyError_('Invalid token or LINE API error')
                    : fail_('AUTH_FAILED', 'Invalid token or LINE API error');
  }

  try {
    switch (action) {
      case '':
        // 旧index.html互換: 旧形式のまま返す
        return jsonResponse_(buildDashboardData(userId));
      case 'getDashboardData':
        return ok_(getDashboardDataCached(userId));
      default:
        return fail_('NOT_FOUND', 'Unknown action: ' + action);
    }
  } catch (err) {
    return isLegacy ? legacyError_('Server error: ' + err.toString())
                    : fail_('SERVER_ERROR', err.toString());
  }
}

// ---------- api_dashboard: キャッシュ ----------
function getDashboardDataCached(userId) {
  const cache = CacheService.getUserCache();
  const key = 'dashboard_' + userId;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const data = buildDashboardData(userId);
  try { cache.put(key, JSON.stringify(data), 60); } catch (err) {}
  return data;
}

// ---------- api_dashboard: 本体(純粋なデータを返す) ----------
function buildDashboardData(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- usersシート ---
  const usersSheet = ss.getSheetByName('users');
  const usersData = usersSheet.getDataRange().getValues();
  const userHeader = usersData[0];
  const getIdx = function (col) { return userHeader.indexOf(col); };

  let userData = { name: 'ユーザー', targetCalories: 2000, tdee: 2000, targetWeight: 60, isPremium: false };
  for (let i = 1; i < usersData.length; i++) {
    if (usersData[i][getIdx('user_id')] === userId) {
      userData.name = usersData[i][getIdx('User_Name')] || usersData[i][getIdx('user_name')] || 'ユーザー';
      userData.targetCalories = Number(usersData[i][getIdx('target_calories')]) || 2000;
      userData.targetWeight = Number(usersData[i][getIdx('target_weight')]) || 60;
      userData.isPremium = Boolean(usersData[i][getIdx('is_premium')]);
      break;
    }
  }

  // --- 理想目標値 ---
  const idealCal = userData.targetCalories || userData.tdee;
  const ideal = {
    calories: idealCal,
    protein: Math.round((idealCal * 0.20) / 4),
    fat: Math.round((idealCal * 0.25) / 9),
    carbs: Math.round((idealCal * 0.55) / 4),
    fiber: 20, vitamins: 100, zinc: 10, magnesium: 320, sodium: 8, iron: 7.5
  };

  // --- logsシート過去7日 ---
  const logsSheet = ss.getSheetByName('logs');
  const logsData = logsSheet.getDataRange().getValues();
  const logHeader = logsData[0];
  const getLogIdx = function (col) { return logHeader.indexOf(col); };

  const daysMap = {};
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const label = (d.getMonth() + 1) + '/' + d.getDate() + '(' + ['日','月','火','水','木','金','土'][d.getDay()] + ')';
    daysMap[dateKey] = { date: dateKey, label: label, calories: 0, protein: 0, fat: 0, carbs: 0 };
  }

  let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
  let totalFiber = 0, totalVit = 0, totalZinc = 0, totalMag = 0, totalSodium = 0, totalIron = 0;

  for (let i = 1; i < logsData.length; i++) {
    const row = logsData[i];
    if (row[getLogIdx('user_id')] === userId) {
      const rawDate = new Date(row[getLogIdx('timestamp')]);
      if (!isNaN(rawDate)) {
        const dateKey = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (daysMap[dateKey]) {
          const c = Number(row[getLogIdx('calories')]) || 0;
          const p = Number(row[getLogIdx('protein')]) || 0;
          const f = Number(row[getLogIdx('fat')]) || 0;
          const carb = Number(row[getLogIdx('carbs')]) || 0;
          daysMap[dateKey].calories += c;
          daysMap[dateKey].protein += p;
          daysMap[dateKey].fat += f;
          daysMap[dateKey].carbs += carb;
          totalCal += c; totalP += p; totalF += f; totalC += carb;
          totalFiber += getLogIdx('fiber') !== -1 && row[getLogIdx('fiber')] !== '' ? Number(row[getLogIdx('fiber')]) : (carb * 0.08);
          totalVit += getLogIdx('vitamins') !== -1 && row[getLogIdx('vitamins')] !== '' ? Number(row[getLogIdx('vitamins')]) : 12;
          totalZinc += getLogIdx('zinc') !== -1 && row[getLogIdx('zinc')] !== '' ? Number(row[getLogIdx('zinc')]) : (p * 0.08);
          totalMag += getLogIdx('magnesium') !== -1 && row[getLogIdx('magnesium')] !== '' ? Number(row[getLogIdx('magnesium')]) : (p * 2.5);
          totalSodium += getLogIdx('sodium') !== -1 && row[getLogIdx('sodium')] !== '' ? Number(row[getLogIdx('sodium')]) : 7;
          totalIron += getLogIdx('iron') !== -1 && row[getLogIdx('iron')] !== '' ? Number(row[getLogIdx('iron')]) : 0.9;
        }
      }
    }
  }

  const stats = {
    avgCalories: Math.round(totalCal / 7),
    avgProtein: Math.round(totalP / 7),
    avgFat: Math.round(totalF / 7),
    avgCarbs: Math.round(totalC / 7),
    avgFiber: Math.round(totalFiber / 7),
    avgVitamins: Math.round((totalVit / 7) * 7.1),
    avgZinc: Math.round((totalZinc / 7) * 10) / 10,
    avgMagnesium: Math.round(totalMag / 7),
    avgSodium: Math.round((totalSodium / 7) * 10) / 10,
    avgIron: Math.round((totalIron / 7) * 10) / 10
  };

  let successDays = 0;
  Object.values(daysMap).forEach(function (d) {
    if (d.calories >= idealCal * 0.85 && d.calories <= idealCal * 1.15) successDays++;
  });

  const deficiencies = [];
  if (stats.avgFat < ideal.fat) deficiencies.push({ name: '脂質 (Fat)', diff: (ideal.fat - stats.avgFat) + 'g / 日', food: 'アボカド、ナッツ類', color: 'text-amber-500' });
  if (stats.avgFiber < ideal.fiber) deficiencies.push({ name: '食物繊維 (Fiber)', diff: (ideal.fiber - stats.avgFiber) + 'g / 日', food: 'きのこ類、野菜類', color: 'text-emerald-500' });
  if (stats.avgIron < ideal.iron) deficiencies.push({ name: '鉄分 (Iron)', diff: (ideal.iron - stats.avgIron).toFixed(1) + 'mg / 日', food: 'ほうれん草、赤身肉', color: 'text-rose-500' });

  return {
    user: userData,
    ideal: ideal,
    stats: stats,
    daily: Object.values(daysMap),
    summary: {
      score: Math.min(Math.round(80 + (successDays * 3)), 98),
      successDays: successDays,
      deficiencies: deficiencies
    }
  };
}