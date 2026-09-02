// setup_sheets.gs — 新7シート作成 + Training_Master初期データ（冪等）
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const sheets = {
    'Training_Master': ['master_id','exercise_name','exercise_type','body_part','is_bodyweight','default_met_value','met_category','input_mode','search_keywords','is_active','created_at','updated_at'],
    'Training_Menus': ['menu_id','user_id','master_id','menu_name','training_type','input_profile','display_order','is_active','created_at','updated_at'],
    'Training_Logs': ['training_log_id','user_id','menu_id','master_id','exercise_name_snapshot','training_type','training_date','duration_min','distance_km','incline_pct','rpe','rpe_source','estimated_calories','calorie_estimation_method','calorie_formula_version','body_weight','memo','created_at','updated_at'],
    'Training_Sets': ['set_id','training_log_id','set_no','weight_kg','reps','rpe','is_bodyweight','duration_sec','rest_sec','memo','created_at'],
    'Body_Composition': ['body_log_id','user_id','measured_at','measurement_device','weight_kg','body_fat_pct','skeletal_muscle_kg','muscle_mass_kg','body_water_pct','visceral_fat','bmr','waist_cm','other_data','memo','created_at'],
    'Nutrition_Reference': ['nutrient_id','nutrient_name','unit','gender','age_min','age_max','reference_type','reference_value','calculation_type','source','source_year','note','is_active'],
    'Goal_Plans': ['plan_id','user_id','goal_mode','plan_start_date','plan_end_date','start_weight_kg','target_weight_kg','bmr_kcal','tdee_kcal','pal_used','target_calories','target_protein_g','target_fat_g','target_carbs_g','status','change_reason','created_at','ended_at']
  };

  Object.keys(sheets).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if ((sh.getRange(1, 1).getValue() || '') === '') {
      sh.getRange(1, 1, 1, sheets[name].length).setValues([sheets[name]]);
      sh.setFrozenRows(1);
    }
  });

  // Training_Master 初期データ15種目（met_category分類済み）
  const master = ss.getSheetByName('Training_Master');
  if (master.getLastRow() < 2) {
    const now = new Date();
    const rows = [
      ['tm_strength_general','筋トレ（汎用）','strength','full_body',false,3.5,'general_weight','both','筋トレ、トレーニング',true,now,now],
      ['tm_pushup','腕立て伏せ','strength','chest',true,3.0,'bodyweight_general','both','プッシュアップ、腕立て',true,now,now],
      ['tm_squat_bw','スクワット（自重）','strength','legs',true,3.0,'bodyweight_general','both','自重スクワット、エアスクワット',true,now,now],
      ['tm_bench','ベンチプレス','strength','chest',false,5.0,'heavy_compound','both','チェストプレス、バーベルベンチプレス',true,now,now],
      ['tm_squat','スクワット','strength','legs',false,5.0,'heavy_compound','both','バーベルスクワット、バックスクワット',true,now,now],
      ['tm_deadlift','デッドリフト','strength','back',false,5.0,'heavy_compound','both','DL',true,now,now],
      ['tm_curl','ダンベルカール','strength','arms',false,3.5,'general_weight','both','アームカール、バイセプスカール',true,now,now],
      ['tm_ohp','ショルダープレス','strength','shoulder',false,3.5,'general_weight','both','オーバーヘッドプレス、ミリタリープレス',true,now,now],
      ['tm_pullup','懸垂','strength','back',true,6.5,'bodyweight_vigorous','both','チンニング、プルアップ',true,now,now],
      ['tm_burpee','バーピー','strength','full_body',true,6.5,'bodyweight_vigorous','both','バーピージャンプ',true,now,now],
      ['tm_circuit','サーキットトレーニング','circuit','full_body',false,5.8,'circuit','both','サーキット',true,now,now],
      ['tm_running','ランニング','cardio','cardio',false,9.8,'','both','ジョギング、走行',true,now,now],
      ['tm_walking','ウォーキング','cardio','cardio',false,3.5,'','both','散歩、歩行',true,now,now],
      ['tm_cycling','サイクリング','cardio','cardio',false,6.8,'','both','バイク、自転車、ポタリング',true,now,now],
      ['tm_swim','水泳','cardio','cardio',false,7.0,'','both','スイム',true,now,now]
    ];
    master.getRange(2, 1, rows.length, 12).setValues(rows);
  }

  Logger.log('setup complete: 7 sheets');
}