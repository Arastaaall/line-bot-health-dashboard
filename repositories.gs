// repositories.gs — Sheet読み書き共通関数
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function getRows(sheetName, filterFn) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
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
}

function updateRowById(sheetName, idColumn, idValue, patch) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
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
      return true;
    }
  }
  return false;
}

function deleteRowById(sheetName, idColumn, idValue) {
  const sh = sheet_(sheetName);
  const values = sh.getDataRange().getValues();
  const idIdx = values[0].indexOf(idColumn);
  if (idIdx === -1) return false;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIdx]) === String(idValue)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
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
  return count;
}