// repositories.gs — Sheet読み書き共通関数
// ===== S2: 実行単位シートmemo =====
// GAS V8はグローバルが跨実行で残り得るため、doPost入口で必ずresetすること。
var __sheetMemo = null;
function resetSheetMemo_() { __sheetMemo = {}; }
function invalidateSheetMemo_(sheetName) { if (__sheetMemo) delete __sheetMemo[sheetName]; }

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}
// valuesをmemo化（sheet取得＋getDataRangeの往復を1実行1回に）
function sheetValues_(name) {
  if (!__sheetMemo) __sheetMemo = {};
  if (__sheetMemo[name]) return __sheetMemo[name];
  const sh = sheet_(name);
  const t0 = Date.now();
  const values = sh.getDataRange().getValues();
  perfSheet_(name, Date.now() - t0, values.length);
  __sheetMemo[name] = values;
  return values;
}
function getRows(sheetName, filterFn) {
  const values = sheetValues_(sheetName);
  if (values.length < 2) return [];
  const header = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = values[i][c];
    if (!filterFn || filterFn(obj)) out.push(obj);
  }
  return out;
}

function findById(sheetName, idColumn, idValue) {
  const rows = getRows(sheetName, function (r) { return String(r[idColumn]) === String(idValue); });
  return rows.length ? rows[0] : null;
}

function appendRowObj(sheetName, obj) {
  const sh = sheet_(sheetName);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = header.map(function (col) { return obj.hasOwnProperty(col) ? obj[col] : ''; });
  sh.appendRow(row);
  invalidateSheetMemo_(sheetName);
}

function updateRowById(sheetName, idColumn, idValue, patch) {
  const sh = sheet_(sheetName);
  const values = sheetValues_(sheetName);
  const header = values[0];
  const idIdx = header.indexOf(idColumn);
  if (idIdx === -1) return false;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(idValue)) {
      const row = values[i].slice();
      Object.keys(patch).forEach(function (col) {
        const c = header.indexOf(col);
        if (c !== -1) row[c] = patch[col];
      });
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      invalidateSheetMemo_(sheetName);
      return true;
    }
  }
  invalidateSheetMemo_(sheetName);
  return false;
}

function deleteRowById(sheetName, idColumn, idValue) {
  const sh = sheet_(sheetName);
  const values = sheetValues_(sheetName);
  const idIdx = values[0].indexOf(idColumn);
  if (idIdx === -1) return false;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(idValue)) {
      sh.deleteRow(i + 1);
      invalidateSheetMemo_(sheetName);
      return true;
    }
  }
  invalidateSheetMemo_(sheetName);
  return false;
}

function deleteRowsByForeignKey(sheetName, fkColumn, fkValue) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const fkIdx = values[0].indexOf(fkColumn);
  if (fkIdx === -1) return 0;
  let count = 0;
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][fkIdx]) === String(fkValue)) {
      sh.deleteRow(i + 1);
      count++;
    }
  }
  invalidateSheetMemo_(sheetName);
  return count;
}

function appendRowsObjs(sheetName, objs) {
  if (!objs || objs.length === 0) return;
  const sh = sheet_(sheetName);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const rows = objs.map(function (obj) {
    return header.map(function (col) { return obj.hasOwnProperty(col) ? obj[col] : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, header.length).setValues(rows);
  invalidateSheetMemo_(sheetName);
}
