// utils.gs — 共通ヘルパー
function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function ok_(data) { return jsonResponse_({ ok: true, data: data }); }
function fail_(code, message) { return jsonResponse_({ ok: false, error: { code: code, message: message } }); }
function legacyError_(message) { return jsonResponse_({ error: message }); }

function nowIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
}
function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function dateKeyOf_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function makeId_(prefix) { return prefix + '_' + Utilities.getUuid(); }

function toNumber_(v, fallback) {
  if (v === '' || v === null || v === undefined) return (fallback === undefined ? null : fallback);
  const n = Number(v);
  return isNaN(n) ? (fallback === undefined ? null : fallback) : n;
}
function toBool_(v) {
  if (v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'FALSE' || v === 'false' || v === 0 || v === '0' || v === '' || v === null || v === undefined) return false;
  return Boolean(v);
}

// ===== S1: パフォーマンス計測基盤（debug=1 時のみ有効）=====
// リクエスト単位の計測。doPost側で perfReset_() を呼ばない限り __perf は null のまま＝全呼び出しがno-op（本番ゼロコスト）。
var __perf = null;
var __lockPerf = null;

function perfReset_() {
  __perf = { t0: Date.now(), marks: {}, sheets: {}, cache: {} };
}

function perfMark_(label) {
  if (!__perf) return;
  __perf.marks[label] = Date.now() - __perf.t0;
}

// シート読み込みの計測（呼び出し回数・ms・行数）。calls>1 が「同一リクエスト内の重複読み」の証拠になる。
function perfSheet_(sheetName, ms, rows) {
  if (!__perf) return;
  var e = __perf.sheets[sheetName] || (__perf.sheets[sheetName] = { calls: 0, ms: 0, rows: 0 });
  e.calls += 1;
  e.ms += ms;
  e.rows = rows;
}

function perfReport_() {
  if (!__perf) return null;
  var rep = { total_ms: Date.now() - __perf.t0, marks: {}, sheets: __perf.sheets, cache: __perf.cache };
  var prev = 0;
  Object.keys(__perf.marks).sort(function (a, b) { return __perf.marks[a] - __perf.marks[b]; })
    .forEach(function (k) {
      rep.marks[k] = { at_ms: __perf.marks[k], step_ms: __perf.marks[k] - prev };
      prev = __perf.marks[k];
    });
  return rep;
}
