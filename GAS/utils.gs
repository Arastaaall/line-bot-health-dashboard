// utils.gs — 共通ヘルパー
function jsonResponse_(obj) {
  var body;
  if (__perf && obj && obj._perf) {
    var firstStart = Date.now();
    var firstBody = JSON.stringify(obj);
    var firstMs = Date.now() - firstStart;
    obj._perf.response = {
      stringify_ms: firstMs,
      bytes: Utilities.newBlob(firstBody).getBytes().length
    };

    // _perf.response 自体を含む最終形も計測する。デバッグ時だけ追加シリアライズを行う。
    var finalStart = Date.now();
    body = JSON.stringify(obj);
    var finalMs = Date.now() - finalStart;
    obj._perf.response.stringify_ms = finalMs;
    obj._perf.response.bytes = Utilities.newBlob(body).getBytes().length;
    body = JSON.stringify(obj);
    __perf.response = obj._perf.response;
  } else {
    body = JSON.stringify(obj);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
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
  var t0 = __perf ? Date.now() : 0;
  var result = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (__perf) {
    perfAddProcessing_('dateKeyOf_ms', Date.now() - t0);
    perfCountProcessing_('dateKeyOf_calls', 1);
  }
  return result;
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
  __perf = { t0: Date.now(), marks: {}, sheets: {}, processing: {}, cache: {}, response: null };
}

function perfMark_(label) {
  if (!__perf) return;
  __perf.marks[label] = Date.now() - __perf.t0;
}

function perfAddProcessing_(name, ms) {
  if (!__perf) return;
  __perf.processing[name] = (__perf.processing[name] || 0) + (ms || 0);
}

function perfCountProcessing_(name, count) {
  if (!__perf) return;
  __perf.processing[name] = (__perf.processing[name] || 0) + (count || 0);
}

// シート読み込みの計測（呼び出し回数・ms・行数）。calls>1 が「同一リクエスト内の重複読み」の証拠になる。
function perfSheet_(sheetName, ms, rows) {
  if (!__perf) return;
  var e = __perf.sheets[sheetName] || (__perf.sheets[sheetName] = {
    calls: 0, ms: 0, getValues_ms: 0, objectify_ms: 0, filter_ms: 0,
    objectify_calls: 0, rows: 0, returned_rows: 0
  });
  e.calls += 1;
  e.ms += ms;
  e.getValues_ms += ms;
  e.rows = rows;
}

function perfRows_(sheetName, objectifyMs, filterMs, objectifyCalls, returnedRows) {
  if (!__perf) return;
  var e = __perf.sheets[sheetName] || (__perf.sheets[sheetName] = {
    calls: 0, ms: 0, getValues_ms: 0, objectify_ms: 0, filter_ms: 0,
    objectify_calls: 0, rows: 0, returned_rows: 0
  });
  e.objectify_ms += objectifyMs || 0;
  e.filter_ms += filterMs || 0;
  e.objectify_calls += objectifyCalls || 0;
  e.returned_rows += returnedRows || 0;
}

function perfReport_() {
  if (!__perf) return null;
  var rep = {
    total_ms: Date.now() - __perf.t0,
    marks: {},
    processing: __perf.processing,
    sheets: __perf.sheets,
    cache: __perf.cache,
    response: __perf.response
  };
  var prev = 0;
  Object.keys(__perf.marks).sort(function (a, b) { return __perf.marks[a] - __perf.marks[b]; })
    .forEach(function (k) {
      rep.marks[k] = { at_ms: __perf.marks[k], step_ms: __perf.marks[k] - prev };
      prev = __perf.marks[k];
    });
  return rep;
}
