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