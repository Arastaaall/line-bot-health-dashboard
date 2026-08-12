// ==========================================
// Dashboard Web API (doGet) - line-bot-dashboard-git 用コード
// ==========================================
function doGet(e) {
  const userId = e ? e.parameter.userId : null;
  if (!userId) {
    return ContentService.createTextOutput(JSON.stringify({ error: "userId is required" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // --- 1. usersシートの取得 ---
  const usersSheet = ss.getSheetByName('users');
  const usersData = usersSheet.getDataRange().getValues();
  const userHeader = usersData[0];
  const getIdx = (col) => userHeader.indexOf(col);
  
  let userData = {
    name: "ユーザー",
    targetCalories: 2000,
    tdee: 2000,
    targetWeight: 60,
    isPremium: false
  };

  for (let i = 1; i < usersData.length; i++) {
    if (usersData[i][getIdx('user_id')] === userId) {
      userData.name = usersData[i][getIdx('User_Name')] || usersData[i][getIdx('user_name')] || "ユーザー";
      userData.targetCalories = Number(usersData[i][getIdx('target_calories')]) || 2000;
      userData.targetWeight = Number(usersData[i][getIdx('target_weight')]) || 60;
      userData.isPremium = Boolean(usersData[i][getIdx('is_premium')]);
      break;
    }
  }

  // --- 理想目標値 (8大栄養素の標準基準) ---
  const idealCal = userData.targetCalories || userData.tdee;
  const ideal = {
    calories: idealCal,
    protein: Math.round((idealCal * 0.20) / 4), // g
    fat: Math.round((idealCal * 0.25) / 9),     // g
    carbs: Math.round((idealCal * 0.55) / 4),   // g
    fiber: 20,                                  // 食物繊維 (g)
    vitamins: 100,                              // ビタミン類スコア (%)
    zinc: 10,                                   // 亜鉛 (mg)
    magnesium: 320,                             // マグネシウム (mg)
    sodium: 8,                                  // 塩分(ナトリウム) (g)
    iron: 7.5                                   // 鉄 (mg)
  };

  // --- 2. logsシートから過去7日分の集計 ---
  const logsSheet = ss.getSheetByName('logs');
  const logsData = logsSheet.getDataRange().getValues();
  const logHeader = logsData[0];
  const getLogIdx = (col) => logHeader.indexOf(col);

  const daysMap = {};
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(today.getDate() - i);
    const dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
    const label = `${d.getMonth() + 1}/${d.getDate()}(${['日','月','火','水','木','金','土'][d.getDay()]})`;
    daysMap[dateKey] = { date: dateKey, label: label, calories: 0, protein: 0, fat: 0, carbs: 0 };
  }

  let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
  let totalFiber = 0, totalVit = 0, totalZinc = 0, totalMag = 0, totalSodium = 0, totalIron = 0;

  for (let i = 1; i < logsData.length; i++) {
    const row = logsData[i];
    if (row[getLogIdx('user_id')] === userId) {
      const rawDate = new Date(row[getLogIdx('timestamp')]);
      if (!isNaN(rawDate)) {
        const dateKey = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
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

          // 新設カラム（空データ時は安全な比率で動的補完）
          totalFiber += getLogIdx('fiber') !== -1 && row[getLogIdx('fiber')] !== "" ? Number(row[getLogIdx('fiber')]) : (carb * 0.08);
          totalVit += getLogIdx('vitamins') !== -1 && row[getLogIdx('vitamins')] !== "" ? Number(row[getLogIdx('vitamins')]) : 12;
          totalZinc += getLogIdx('zinc') !== -1 && row[getLogIdx('zinc')] !== "" ? Number(row[getLogIdx('zinc')]) : (p * 0.08);
          totalMag += getLogIdx('magnesium') !== -1 && row[getLogIdx('magnesium')] !== "" ? Number(row[getLogIdx('magnesium')]) : (p * 2.5);
          totalSodium += getLogIdx('sodium') !== -1 && row[getLogIdx('sodium')] !== "" ? Number(row[getLogIdx('sodium')]) : 7;
          totalIron += getLogIdx('iron') !== -1 && row[getLogIdx('iron')] !== "" ? Number(row[getLogIdx('iron')]) : 0.9;
        }
      }
    }
  }

  const avgP = Math.round(totalP / 7);
  const avgF = Math.round(totalF / 7);
  const avgC = Math.round(totalC / 7);
  const avgCal = Math.round(totalCal / 7);

  const stats = {
    avgCalories: avgCal,
    avgProtein: avgP,
    avgFat: avgF,
    avgCarbs: avgC,
    avgFiber: Math.round(totalFiber / 7),
    avgVitamins: Math.round((totalVit / 7) * 7.1), // スコア換算
    avgZinc: Math.round((totalZinc / 7) * 10) / 10,
    avgMagnesium: Math.round(totalMag / 7),
    avgSodium: Math.round((totalSodium / 7) * 10) / 10,
    avgIron: Math.round((totalIron / 7) * 10) / 10
  };

  // 目標達成日数のカウント（カロリーが目標の±15%以内だった日数）
  let successDays = 0;
  Object.values(daysMap).forEach(d => {
    if (d.calories >= idealCal * 0.85 && d.calories <= idealCal * 1.15) {
      successDays++;
    }
  });

  // 不足栄養素の抽出
  const deficiencies = [];
  if (stats.avgFat < ideal.fat) {
    deficiencies.push({ name: "脂質 (Fat)", diff: `${ideal.fat - stats.avgFat}g / 日`, food: "アボカド、ナッツ類", color: "text-amber-500" });
  }
  if (stats.avgFiber < ideal.fiber) {
    deficiencies.push({ name: "食物繊維 (Fiber)", diff: `${ideal.fiber - stats.avgFiber}g / 日`, food: "きのこ類、野菜類", color: "text-emerald-500" });
  }
  if (stats.avgIron < ideal.iron) {
    deficiencies.push({ name: "鉄分 (Iron)", diff: `${(ideal.iron - stats.avgIron).toFixed(1)}mg / 日`, food: "ほうれん草、赤身肉", color: "text-rose-500" });
  }

  const response = {
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

  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
