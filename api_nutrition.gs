// api_nutrition.gs — Phase 4/5（現時点は管理用seedのみ・dispatch非搭載）

// 栄養基準値シード（GASエディタから手動実行・冪等）
// 出典: 厚生労働省「日本人の食事摂取基準（2025年版）」
// 3年齢区分×2性別。鉄(女性)は18-49=月経あり/50-64=月経なしの年齢プロキシ
function seedNutritionReference() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Nutrition_Reference');
  const existing = sh.getDataRange().getValues();
  if (existing.length - 1 > 0) { Logger.log('seed skipped: rows=' + (existing.length - 1)); return; }

  const SRC = 'MHLW日本人の食事摂取基準2025年版';
  const T = [
    ['fiber', '食物繊維', 'g', '目標量', 'p.144', [20, 22, 22], [18, 18, 18]],
    ['calcium', 'カルシウム', 'mg', '推奨量', 'p.283', [800, 750, 750], [650, 650, 650]],
    ['iron', '鉄', 'mg', '推奨量', 'p.345', [7.0, 7.5, 7.0], [10.0, 10.5, 6.0]],
    ['potassium', 'カリウム', 'mg', '目標量', 'p.282', [3000, 3000, 3000], [2600, 2600, 2600]],
    ['magnesium', 'マグネシウム', 'mg', '推奨量', 'p.284', [340, 380, 370], [280, 290, 290]],
    ['zinc', '亜鉛', 'mg', '推奨量', 'p.346', [9.0, 9.5, 9.5], [7.5, 8.0, 8.0]],
    ['vit_a', 'ビタミンA', 'µgRAE', '推奨量', 'p.181', [850, 900, 900], [650, 700, 700]],
    ['vit_c', 'ビタミンC', 'mg', '推奨量', 'p.242', [100, 100, 100], [100, 100, 100]]
  ];
  const bands = [[18, 29], [30, 49], [50, 64]];
  const rows = [];
  T.forEach(function (t) {
     ['男性', '女性'].forEach(function (g, gi) {
      bands.forEach(function (b, bi) {
        rows.push({
          nutrient_id: t[0] + '_' + g + '_' + b[0] + '_' + b[1],
          nutrient_name: t[1],
          unit: t[2],
          gender: g,
          age_min: b[0],
          age_max: b[1],
          reference_type: t[3],
          reference_value: (gi === 0 ? t[5] : t[6])[bi],
          calculation_type: 'fixed',
          source: SRC,
          source_year: 2025,
          note: t[4] + (t[0] === 'iron' && g === 'female' ? (bi < 2 ? '（月経あり値）' : '（月経なし値）') : ''),
          is_active: true
        });
      });
    });
  });
  appendRowsObjs('Nutrition_Reference', rows);
  Logger.log('seed done: rows=' + rows.length);
}
// ===== Phase 4: getNutritionAnalysis（read-only） =====

function nfBounds_(range) {
  const to = todayKey_();
  let from = null;
  if (range === '7d') { const d = new Date(); d.setDate(d.getDate() - 6); from = dateKeyOf_(d); }
  else if (range === '30d') { const d = new Date(); d.setDate(d.getDate() - 29); from = dateKeyOf_(d); }
  else if (range === '90d') { const d = new Date(); d.setDate(d.getDate() - 89); from = dateKeyOf_(d); }
  else if (range === '1y') { const d = new Date(); d.setDate(d.getDate() - 364); from = dateKeyOf_(d); }
  return { from: from, to: to };
}

function nfUserProfile_(userId) {
  const r = findById('users', 'user_id', userId);
  if (!r) return null;
  return { gender: String(r['gender'] || ''), age: toNumber_(r['age'], null), isPremium: toBool_(r['is_premium']) };
}

function nfPfcRange_(age) {
  const p = (age !== null && age >= 50 && age <= 64) ? [14, 20] : [13, 20]; // 2025年版 p.103
  return { protein_pct: p, fat_pct: [20, 30], carbs_pct: [50, 65] }; // p.126 / p.143
}

function nfReferences_(gender, age) {
  let band = [30, 49]; // 年齢不明/範囲外は代表区分
  if (age !== null && age >= 18 && age <= 29) band = [18, 29];
  else if (age !== null && age >= 50 && age <= 64) band = [50, 64];
  const rows = getRows('Nutrition_Reference', function (r) {
    return toBool_(r['is_active']) && String(r['gender']) === gender &&
      Number(r['age_min']) === band[0] && Number(r['age_max']) === band[1];
  });
  const map = {};
    rows.forEach(function (r) {
      // nutrient_id = <key>_<性別>_<ageMin>_<ageMax>。key自体が'_'を含むため末尾3セグメントのみ除去
      const parts = String(r['nutrient_id']).split('_');
      map[parts.slice(0, Math.max(parts.length - 3, 1)).join('_')] = {
      value: Number(r['reference_value']), type: String(r['reference_type']),
      unit: String(r['unit']), name: String(r['nutrient_name'])
    };
  });
  return map;
}

function apiGetNutritionAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  const range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'rangeが不正です' } };
  }
  const effRange = user.isPremium ? range : '7d';
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('nutrition_' + userId + '_' + effRange + '_' + tier, 120, function () {
    return buildNutritionAnalysis_(userId, effRange);
  });
  return { ok: true, data: data };
}

function buildNutritionAnalysis_(userId, range) {
  const b = nfBounds_(range);
  const days = nfDailyMealSummary_(userId, b.from, b.to);
  const recorded = days.length;
  const topStatus = recorded === 0 ? 'empty' : (recorded < 3 ? 'insufficient' : 'ok');
  const profile = nfUserProfile_(userId);
  const genderOk = !!profile && (profile.gender === '男性' || profile.gender === '女性');

  // N1 PFC
  let n1;
  if (recorded === 0) n1 = { status: 'empty' };
  else if (recorded < 3) n1 = { status: 'insufficient' };
  else {
    const sum = days.reduce(function (a, d) {
      a.cal += d.calories; a.p += d.protein; a.f += d.fat; a.c += d.carbs;
      return a;
    }, { cal: 0, p: 0, f: 0, c: 0 });
    const avgP = sum.p / recorded, avgF = sum.f / recorded, avgC = sum.c / recorded;
    const pk = avgP * 4, fk = avgF * 9, ck = avgC * 4;
    const total = pk + fk + ck;
    n1 = {
      status: 'ok',
      avg_calories: Math.round(sum.cal / recorded),
      avg_protein_g: Math.round(avgP * 10) / 10,
      avg_fat_g: Math.round(avgF * 10) / 10,
      avg_carbs_g: Math.round(avgC * 10) / 10,
      ratio_protein_pct: total > 0 ? Math.round(pk / total * 1000) / 10 : null,
      ratio_fat_pct: total > 0 ? Math.round(fk / total * 1000) / 10 : null,
      ratio_carbs_pct: total > 0 ? Math.round(ck / total * 1000) / 10 : null,
      reference_range: nfPfcRange_(profile ? profile.age : null)
    };
  }

  // N2 微量栄養素
  let n2;
  if (recorded === 0) n2 = { status: 'empty', nutrients: [] };
  else if (recorded < 3 || !genderOk) n2 = { status: 'insufficient', nutrients: [] };
  else {
    const refs = nfReferences_(profile.gender, profile.age);
    const list = [];
    ['fiber', 'calcium', 'iron', 'potassium', 'magnesium', 'zinc', 'vit_a', 'vit_c', 'vit_d', 'vit_e', 'vit_b1', 'vit_b2', 'vit_b6', 'vit_b12', 'folate'].forEach(function (k) {
      const ref = refs[k];
      const avgRaw = days.reduce(function (s, d) { return s + (d[k] || 0); }, 0) / recorded;
      // vit_a: Logs保存はIU・基準値はµgRAEのため換算（1µgRAE=3.33IU・MHLW p.181脚注）
      const avg = (k === 'vit_a') ? avgRaw / 3.33 : avgRaw;
      const raw = ref && ref.value > 0 ? (avg / ref.value) * 100 : 0;
      list.push({
        key: k, name: ref ? ref.name : k,
        avg_intake: Math.round(avg * 10) / 10,
        unit: ref ? ref.unit : '', reference_value: ref ? ref.value : null,
        reference_type: ref ? ref.type : '',
        achievement_pct_raw: Math.round(raw * 10) / 10,
        achievement_pct_display: Math.round(Math.min(raw, 200) * 10) / 10
      });
    });
    list.sort(function (a, z) { return a.achievement_pct_raw - z.achievement_pct_raw; });
    n2 = { status: 'ok', nutrients: list };
  }

  // N3 不足ヒント（禁止語不使用・達成率100未満のみ）
  const n3 = [];
  if (n2.status === 'ok') {
    n2.nutrients.slice(0, 3).forEach(function (nut) {
      if (nut.achievement_pct_raw < 100) {
        n3.push({ nutrient_key: nut.key, nutrient_name: nut.name, message: '記録上、' + nut.name + 'の摂取量が少なめです' });
      }
    });
  }

  // N4 食事記録回数
  let n4;
  if (recorded === 0) n4 = { status: 'empty' };
  else if (recorded < 3) n4 = { status: 'insufficient' };
  else n4 = { status: 'ok', avg_meals_per_day: Math.round(days.reduce(function (s, d) { return s + d.meals_count; }, 0) / recorded * 10) / 10 };

  // N5 上位メニュー（空文字/NULL除外）
  let n5 = [];
  if (recorded > 0) {
    const agg = {};
    getRows('logs', function (r) { return String(r['user_id']) === String(userId); }).forEach(function (r) {
      const k = dateKeyOf_(new Date(r['timestamp']));
      if ((b.from && k < b.from) || k > b.to) return;
      const name = String(r['menu_name'] || '').trim();
      if (!name) return;
      if (!agg[name]) agg[name] = { menu_name: name, count: 0, cal: 0, p: 0 };
      agg[name].count += 1;
      agg[name].cal += Number(r['calories']) || 0;
      agg[name].p += Number(r['protein']) || 0;
    });
    n5 = Object.keys(agg).map(function (k) {
      const a = agg[k];
      return { menu_name: a.menu_name, count: a.count, avg_calories: Math.round(a.cal / a.count), avg_protein_g: Math.round(a.p / a.count * 10) / 10 };
    }).sort(function (a, z) { return z.count - a.count; }).slice(0, 5);
  }

  return {
    range: range,
    recorded_days: recorded,
    status: topStatus,
    n1_pfc: n1,
    n2_micronutrients: n2,
    n3_hints: n3,
    n4_meal_frequency: n4,
    n5_top_menus: n5,
    notes: {
      reference: '栄養基準値は成人向けの一般的な目安であり、医学的な診断・保証を行うものではありません。年齢や体質による個人差があります。',
      no_record: '記録がない日は、食べていないことを意味しません。',
      pfc: 'PFC比は食事記録から算出した参考値です。',
      recorded_days: '平均値は記録がある日数を基準に算出しています。',
      protein_bcaa_note: 'BCAA（ロイシン・イソロイシン・バリン）はタンパク質に含まれるアミノ酸です。若年成人では1回あたりのロイシン量と筋タンパク合成の相関は明確でなく、総タンパク質量（目安 約2g/kg/日）が土台です。高齢になるほどアミノ酸への筋の反応が鈍くなるため、1回あたりの量の重要性が上がります。サプリメントは総エネルギーとマクロ栄養素が整った後の補完的位置づけです。本表示は参考情報であり、医学的・効果の保証ではありません。'
    }
  };
}

// ===== Phase 5: 食事履歴（read-only） =====

function nfFormatTs_(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss'+09:00'");
}

function apiGetFoodHistory(userId, params) {
  const user = getUserRecord_(userId);
  const range = String(params.range || '7d');
  if (['7d', '30d', '90d', '1y', 'all'].indexOf(range) === -1) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'rangeが不正です' } };
  }
  const effRange = user.isPremium ? range : '7d';
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('foodhist_' + userId + '_' + effRange + '_' + tier, 120, function () {
    const b = nfBounds_(effRange);
    return {
      range: effRange,
      days: nfDailyMealSummary_(userId, b.from, b.to).map(function (d) {
        return { date: d.date, meals_count: d.meals_count, calories: d.calories, protein: Math.round(d.protein * 10) / 10 };
      })
    };
  });
  return { ok: true, data: data };
}

function apiGetFoodDay(userId, params) {
  const user = getUserRecord_(userId);
  const date = String(params.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'date形式が不正です' } };
  }
  if (!user.isPremium) {
    const b = nfBounds_('7d');
    if (date < b.from || date > b.to) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '無料プランの期間外です' } };
    }
  }
  const tier = user.isPremium ? 'p' : 'f';
  const data = cached_('foodday_' + userId + '_' + date + '_' + tier, 60, function () {
    const rows = getRows('logs', function (r) {
      return String(r['user_id']) === String(userId) && dateKeyOf_(new Date(r['timestamp'])) === date;
    }).sort(function (a, b) {
      const ta = new Date(a['timestamp']).getTime();
      const tb = new Date(b['timestamp']).getTime();
      if (ta !== tb) return ta - tb;
      return String(a['log_id'] || '').localeCompare(String(b['log_id'] || ''));
    });
    return {
      date: date,
      status: rows.length ? 'ok' : 'empty',
      meals: rows.map(function (r) {
        return {
          timestamp: nfFormatTs_(r['timestamp']),
          menu_name: String(r['menu_name'] || ''),
          calories: Number(r['calories']) || 0,
          protein: Math.round((Number(r['protein']) || 0) * 10) / 10,
          fat: Math.round((Number(r['fat']) || 0) * 10) / 10,
          carbs: Math.round((Number(r['carbs']) || 0) * 10) / 10,
          advice: String(r['advice'] || '')
        };
      })
    };
  });
  return { ok: true, data: data };
}