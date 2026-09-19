// src/server/auth.ts
import { createHash } from "node:crypto";
var authCache = /* @__PURE__ */ new Map();
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
async function checkAuth(token) {
  if (!token) return null;
  const key = hashToken(token);
  const hit = authCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.userId;
  if (hit) authCache.delete(key);
  try {
    const response = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const profile = await response.json();
    if (!profile.userId) return null;
    authCache.set(key, { userId: profile.userId, expiresAt: Date.now() + 3e5 });
    return profile.userId;
  } catch {
    return null;
  }
}

// src/server/sheets.ts
import { createSign } from "node:crypto";
var accessToken = null;
function base64Url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
function serviceAccountPrivateKey() {
  return requiredEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n");
}
async function getGoogleAccessToken() {
  if (accessToken && accessToken.expiresAt > Date.now() + 6e4) return accessToken.value;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1e3);
  const claim = base64Url(JSON.stringify({
    iss: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${base64Url(signer.sign(serviceAccountPrivateKey()))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString()
  });
  if (!response.ok) throw new Error("Google authentication failed");
  const json = await response.json();
  if (!json.access_token) throw new Error("Google authentication returned no access token");
  accessToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1e3 };
  return json.access_token;
}
function sheetRange(sheetName) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}
var SheetsClient = class {
  spreadsheetId;
  constructor() {
    this.spreadsheetId = requiredEnv("GOOGLE_SPREADSHEET_ID");
  }
  async values(sheetName) {
    const token = await getGoogleAccessToken();
    const query = new URLSearchParams({
      majorDimension: "ROWS",
      // Preserve GAS getValues() number/boolean types while keeping date cells
      // readable instead of exposing Sheets' serial-date numbers.
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING"
    });
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values/${encodeURIComponent(sheetRange(sheetName))}?${query}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Google Sheets read failed");
    const json = await response.json();
    return json.values ?? [[]];
  }
  async batchValues(sheetNames) {
    const token = await getGoogleAccessToken();
    const query = new URLSearchParams({
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING"
    });
    sheetNames.forEach((sheetName) => query.append("ranges", sheetRange(sheetName)));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}/values:batchGet?${query}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Google Sheets batch read failed");
    const json = await response.json();
    const result = /* @__PURE__ */ new Map();
    sheetNames.forEach((sheetName, index) => {
      result.set(sheetName, json.valueRanges?.[index]?.values ?? [[]]);
    });
    return result;
  }
};
async function sheetValues(context, sheetName) {
  const cached = context.sheetMemo.get(sheetName);
  if (cached) return cached;
  const pending = context.sheetPending.get(sheetName);
  if (pending) return pending;
  const request = context.sheets.values(sheetName);
  context.sheetPending.set(sheetName, request);
  try {
    const values = await request;
    context.sheetMemo.set(sheetName, values);
    return values;
  } finally {
    context.sheetPending.delete(sheetName);
  }
}
async function batchSheetValues(context, sheetNames) {
  const names = [...new Set(sheetNames)];
  const missing = names.filter((name) => !context.sheetMemo.has(name) && !context.sheetPending.has(name));
  if (missing.length) {
    const batch = context.sheets.batchValues(missing);
    missing.forEach((name) => {
      const pending = batch.then((values) => {
        const result2 = values.get(name) ?? [[]];
        context.sheetMemo.set(name, result2);
        return result2;
      }).finally(() => {
        context.sheetPending.delete(name);
      });
      context.sheetPending.set(name, pending);
    });
  }
  const result = /* @__PURE__ */ new Map();
  await Promise.all(names.map(async (name) => {
    result.set(name, await sheetValues(context, name));
  }));
  return result;
}
async function getRows(context, sheetName, filter) {
  const values = await sheetValues(context, sheetName);
  if (values.length < 2) return [];
  const header = values[0].map((value) => String(value ?? ""));
  const rows = [];
  for (let index = 1; index < values.length; index += 1) {
    const row = {};
    for (let column = 0; column < header.length; column += 1) row[header[column]] = values[index][column] ?? "";
    if (!filter || filter(row)) rows.push(row);
  }
  return rows;
}
async function findById(context, sheetName, idColumn, idValue) {
  const rows = await getRows(context, sheetName, (row) => String(row[idColumn] ?? "") === String(idValue ?? ""));
  return rows[0] ?? null;
}

// src/server/context.ts
function createRequestContext() {
  return { sheets: new SheetsClient(), sheetMemo: /* @__PURE__ */ new Map(), sheetPending: /* @__PURE__ */ new Map() };
}

// src/server/gasProxy.ts
var MUTATION_ACTIONS = /* @__PURE__ */ new Set([
  "createTrainingMenu",
  "updateTrainingMenu",
  "updateTrainingMenuOrder",
  "deleteTrainingMenu",
  "createTrainingLog",
  "createTrainingLogsBatch",
  "updateTrainingLog",
  "deleteTrainingLog",
  "createBodyCompositionLog",
  "deleteBodyCompositionLog"
]);
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
function gasUrl() {
  const value = process.env.VITE_GAS_URL;
  if (!value) throw new Error("GAS backend is not configured");
  return value;
}
function redirectUrl(response, currentUrl) {
  const location = response.headers.get("location");
  if (!location) return null;
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}
function isMutationAction(action) {
  return MUTATION_ACTIONS.has(action);
}
async function proxyMutation(request) {
  const body = JSON.stringify(request);
  let url = gasUrl();
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = redirectUrl(response, url);
    if (!next) return { status: 502, body: failure("GAS_PROXY_ERROR", "GAS\u5FDC\u7B54\u306E\u8EE2\u9001\u5148\u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093") };
    url = next;
  }
  const raw = await response.text();
  try {
    const json = JSON.parse(raw);
    return { status: response.status >= 200 && response.status < 600 ? response.status : 502, body: json };
  } catch {
    return { status: 502, body: failure("GAS_PROXY_ERROR", "GAS\u304B\u3089\u4E0D\u6B63\u306A\u5FDC\u7B54\u3092\u53D7\u4FE1\u3057\u307E\u3057\u305F") };
  }
}

// src/server/date.ts
var JST = "Asia/Tokyo";
function parts(date) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: JST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type) => values.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}
function asDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 864e5);
  }
  const source = String(value ?? "").trim();
  if (!source) return new Date(Number.NaN);
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(source)) {
    const iso = source.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const slash = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const match = iso || slash;
    if (match) {
      const year = iso ? match[1] : match[3];
      const month = iso ? match[2] : match[1];
      const day = iso ? match[3] : match[2];
      const hour = (iso ? match[4] : match[4]) ?? "00";
      const minute = (iso ? match[5] : match[5]) ?? "00";
      const second = (iso ? match[6] : match[6]) ?? "00";
      return /* @__PURE__ */ new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+09:00`);
    }
  }
  return new Date(source);
}
function dateKeyOf(value) {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
}
function todayKey() {
  return dateKeyOf(/* @__PURE__ */ new Date());
}
function formatFoodTimestamp(value) {
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
}
function addDays(date, amount) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + amount);
  return copy;
}

// src/server/growthApi.ts
import { createHash as createHash2 } from "node:crypto";
var datasets = {};
function setGrowthDatasets(input) {
  datasets = input;
}
function getRows2(sheetName, filterFn) {
  const rows = datasets[sheetName] || [];
  return filterFn ? rows.filter(filterFn) : rows.slice();
}
function findById2(sheetName, idColumn, idValue) {
  return getRows2(sheetName, (row) => String(row[idColumn] ?? "") === String(idValue ?? ""))[0] || null;
}
function toNumber_(value, fallback = null) {
  if (value === "" || value === null || value === void 0) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function toBool_(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function dateKeyOf_(value) {
  return dateKeyOf(value);
}
function todayKey_() {
  return todayKey();
}
function jstHour_(value) {
  const parts2 = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false }).formatToParts(new Date(value));
  return Number(parts2.find((part) => part.type === "hour")?.value || 0);
}
function perfMark_(_label) {
}
function perfAddProcessing_(_name, _ms) {
}
var __perf = null;
var Utilities = {
  DigestAlgorithm: { MD5: "MD5" },
  computeDigest: (_algorithm, value) => Array.from(createHash2("md5").update(String(value)).digest())
};
function cached_(_key, _ttl, fn) {
  return fn();
}
function getUserRecord_(userId) {
  const row = getRows2("users", (r) => String(r.user_id ?? "") === String(userId))[0];
  return {
    userId,
    name: row ? row.User_Name || row.user_name || "\u30E6\u30FC\u30B6\u30FC" : "\u30E6\u30FC\u30B6\u30FC",
    weight: row ? toNumber_(row.weight) : null,
    height: row ? toNumber_(row.height) : null,
    targetCalories: row ? toNumber_(row.target_calories) : null,
    isPremium: row ? toBool_(row.is_premium) : false
  };
}
function apiGetTrainingMenus(userId, _params) {
  const user = getUserRecord_(userId);
  const menus = getRows2("Training_Menus", (r) => String(r.user_id ?? "") === String(userId) && toBool_(r.is_active)).sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
  return { ok: true, data: { menus, limit: user.isPremium ? null : 5 } };
}
function getGoalPlansCached_(userId) {
  const plans = getRows2("Goal_Plans", (r) => String(r.user_id ?? "") === String(userId));
  let activePlan = null;
  const history = [];
  plans.forEach((plan) => {
    if (String(plan.status || "").toLowerCase() === "active") {
      if (!activePlan || String(plan.start_date || "") > String(activePlan.start_date || "")) {
        if (activePlan) history.push(activePlan);
        activePlan = plan;
      } else history.push(plan);
    } else history.push(plan);
  });
  history.sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
  return { active_plan: activePlan, history, notes: { disclaimer: "\u76EE\u6A19\u9054\u6210\u5EA6\u304A\u3088\u3073\u8868\u793A\u306F\u73FE\u5728\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u308B\u76EE\u6A19\u30D7\u30E9\u30F3\u306B\u57FA\u3065\u304F\u53C2\u8003\u5024\u3067\u3059\u3002" } };
}
function apiGetGrowthSummary(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || "7d");
  if (["7d", "30d", "90d", "1y", "all"].indexOf(range) === -1) range = "7d";
  if (!user.isPremium) range = "7d";
  const tier = user.isPremium ? "p" : "f";
  const data = cached_("growth_" + userId + "_" + range + "_" + tier, 120, function() {
    return buildGrowthSummary_(userId, range, user.isPremium);
  });
  return { ok: true, data };
}
function apiGetGrowthAll(userId, params) {
  const range = params && params.range ? params.range : "7d";
  perfMark_("growth_all_start");
  const summaryStart = __perf ? Date.now() : 0;
  const summary = apiGetGrowthSummary(userId, { range }).data;
  if (__perf) perfAddProcessing_("growth_summary_ms", Date.now() - summaryStart);
  const trainingStart = __perf ? Date.now() : 0;
  const training = apiGetTrainingAnalysis(userId, { range }).data;
  if (__perf) perfAddProcessing_("growth_training_ms", Date.now() - trainingStart);
  const mealStart = __perf ? Date.now() : 0;
  const meal = apiGetMealAnalysis(userId, { range }).data;
  if (__perf) perfAddProcessing_("growth_meal_ms", Date.now() - mealStart);
  const bodyStart = __perf ? Date.now() : 0;
  const body = apiGetBodyAnalysis(userId, { range }).data;
  if (__perf) perfAddProcessing_("growth_body_ms", Date.now() - bodyStart);
  const menusStart = __perf ? Date.now() : 0;
  const menus = apiGetTrainingMenus(userId, {}).data;
  if (__perf) perfAddProcessing_("growth_menus_ms", Date.now() - menusStart);
  perfMark_("growth_all_end");
  return {
    ok: true,
    data: {
      summary,
      training,
      meal,
      body,
      menus
    }
  };
}
function buildGrowthSummary_(userId, range, isPremium) {
  const user = getUserRecord_(userId);
  const to = todayKey_();
  let from = null;
  if (range === "7d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 6);
    from = dateKeyOf_(d);
  } else if (range === "30d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 29);
    from = dateKeyOf_(d);
  } else if (range === "90d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 89);
    from = dateKeyOf_(d);
  } else if (range === "1y") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 364);
    from = dateKeyOf_(d);
  }
  const weekly = range === "1y" || range === "all";
  function bucketKey(k) {
    if (!weekly) return k;
    const d = /* @__PURE__ */ new Date(k + "T00:00:00");
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return dateKeyOf_(d);
  }
  const inRange = function(k) {
    return (!from || k >= from) && k <= to;
  };
  const tLogs = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId) && inRange(dateKeyOf_(new Date(r["training_date"])));
  });
  const logBucket = {};
  const logExKey = {};
  tLogs.forEach(function(l) {
    const id = String(l["training_log_id"]);
    logBucket[id] = bucketKey(dateKeyOf_(new Date(l["training_date"])));
    const mid = String(l["master_id"] || "");
    logExKey[id] = mid !== "" ? mid : String(l["exercise_name_snapshot"]);
  });
  const tSets = getRows2("Training_Sets", function(s) {
    return !!logBucket[String(s["training_log_id"])];
  });
  const bLogs = getRows2("Body_Composition", function(r) {
    return String(r["user_id"]) === String(userId) && inRange(dateKeyOf_(new Date(r["measured_at"])));
  });
  const mLogs = getRows2("logs", function(r) {
    return String(r["user_id"]) === String(userId) && inRange(dateKeyOf_(new Date(r["timestamp"])));
  });
  const tMap = {};
  tLogs.forEach(function(l) {
    const k = logBucket[String(l["training_log_id"])];
    if (!tMap[k]) tMap[k] = { volume_kg: 0, exercise_logs: 0, cardio_min: 0, estimated_kcal: 0 };
    tMap[k].exercise_logs += 1;
    tMap[k].cardio_min += toNumber_(l["duration_min"], 0) || 0;
    tMap[k].estimated_kcal += toNumber_(l["estimated_calories"], 0) || 0;
  });
  let totalVolume = 0;
  tSets.forEach(function(s) {
    const k = logBucket[String(s["training_log_id"])];
    if (!k) return;
    const w = toNumber_(s["weight_kg"], null);
    const reps = toNumber_(s["reps"], 0) || 0;
    if (w !== null && w > 0) {
      tMap[k].volume_kg += w * reps;
      totalVolume += w * reps;
    }
  });
  function dailySeries(map, valueFn) {
    if (range === "all") return Object.keys(map).sort().map(valueFn);
    const keys = [];
    const cur = /* @__PURE__ */ new Date((weekly ? bucketKey(from) : from) + "T00:00:00");
    const end = /* @__PURE__ */ new Date((weekly ? bucketKey(to) : to) + "T00:00:00");
    while (cur <= end) {
      keys.push(dateKeyOf_(cur));
      cur.setDate(cur.getDate() + (weekly ? 7 : 1));
    }
    return keys.map(valueFn);
  }
  const trainingDaily = dailySeries(tMap, function(k) {
    const b = tMap[k] || { volume_kg: 0, exercise_logs: 0, cardio_min: 0, estimated_kcal: 0 };
    return { date: k, volume_kg: b.volume_kg, exercise_logs: b.exercise_logs, cardio_min: b.cardio_min, estimated_kcal: b.estimated_kcal };
  });
  const activeDays = {};
  tLogs.forEach(function(l) {
    activeDays[dateKeyOf_(new Date(l["training_date"]))] = true;
  });
  const trainingTotals = {
    volume_kg: totalVolume,
    exercise_logs: tLogs.length,
    active_days: Object.keys(activeDays).length,
    cardio_min: tLogs.reduce(function(s, l) {
      return s + (toNumber_(l["duration_min"], 0) || 0);
    }, 0),
    estimated_kcal: tLogs.reduce(function(s, l) {
      return s + (toNumber_(l["estimated_calories"], 0) || 0);
    }, 0)
  };
  const eMap = {};
  tLogs.forEach(function(l) {
    const key = logExKey[String(l["training_log_id"])];
    if (!eMap[key]) {
      const mid = String(l["master_id"] || "");
      eMap[key] = { name: String(l["exercise_name_snapshot"]), master_id: mid !== "" ? mid : null, exercise_logs: 0, volume_kg: 0, max_weight_kg: null, last_date: null, training_type: String(l["training_type"]) };
    }
    const e = eMap[key];
    e.exercise_logs += 1;
    const k = dateKeyOf_(new Date(l["training_date"]));
    if (!e.last_date || k > e.last_date) e.last_date = k;
  });
  tSets.forEach(function(s) {
    const key = logExKey[String(s["training_log_id"])];
    if (!key) return;
    const w = toNumber_(s["weight_kg"], null);
    const reps = toNumber_(s["reps"], 0) || 0;
    if (w !== null && w > 0) {
      eMap[key].volume_kg += w * reps;
      if (eMap[key].max_weight_kg === null || w > eMap[key].max_weight_kg) eMap[key].max_weight_kg = w;
    }
  });
  const exerciseStats = Object.keys(eMap).map(function(k) {
    return eMap[k];
  }).sort(function(a, b) {
    return a.last_date < b.last_date ? 1 : -1;
  });
  const wByDate = {};
  bLogs.forEach(function(r) {
    const w = toNumber_(r["weight_kg"], null);
    if (w === null) return;
    const k = dateKeyOf_(new Date(r["measured_at"]));
    if (!wByDate[k] || new Date(r["measured_at"]) > new Date(wByDate[k].raw)) {
      wByDate[k] = { raw: r["measured_at"], weight_kg: w };
    }
  });
  const weightSeries = Object.keys(wByDate).sort().map(function(k) {
    return { date: k, weight_kg: wByDate[k].weight_kg };
  });
  let bodycompSeries = [];
  if (isPremium) {
    bodycompSeries = bLogs.filter(function(r) {
      return toNumber_(r["body_fat_pct"], null) !== null || toNumber_(r["skeletal_muscle_kg"], null) !== null;
    }).sort(function(a, b) {
      return new Date(a["measured_at"]) - new Date(b["measured_at"]);
    }).map(function(r) {
      return {
        date: dateKeyOf_(new Date(r["measured_at"])),
        body_fat_pct: toNumber_(r["body_fat_pct"], null),
        skeletal_muscle_kg: toNumber_(r["skeletal_muscle_kg"], null)
      };
    });
  }
  const latestWeight = weightSeries.length ? weightSeries[weightSeries.length - 1].weight_kg : null;
  let bmi = null;
  if (latestWeight !== null && user.height !== null && user.height > 0) {
    const hm = user.height / 100;
    bmi = Math.round(latestWeight / (hm * hm) * 10) / 10;
  }
  const detailRows = bLogs.filter(function(r) {
    return toNumber_(r["body_fat_pct"], null) !== null || toNumber_(r["skeletal_muscle_kg"], null) !== null;
  }).sort(function(a, b) {
    return new Date(b["measured_at"]) - new Date(a["measured_at"]);
  });
  const latestBodycomp = detailRows.length ? {
    date: dateKeyOf_(new Date(detailRows[0]["measured_at"])),
    body_fat_pct: toNumber_(detailRows[0]["body_fat_pct"], null),
    skeletal_muscle_kg: toNumber_(detailRows[0]["skeletal_muscle_kg"], null),
    muscle_mass_kg: toNumber_(detailRows[0]["muscle_mass_kg"], null),
    visceral_fat: toNumber_(detailRows[0]["visceral_fat"], null),
    bmr: toNumber_(detailRows[0]["bmr"], null),
    waist_cm: toNumber_(detailRows[0]["waist_cm"], null)
  } : null;
  const iMap = {};
  mLogs.forEach(function(r) {
    const k = bucketKey(dateKeyOf_(new Date(r["timestamp"])));
    iMap[k] = (iMap[k] || 0) + (Number(r["calories"]) || 0);
  });
  const intakeDaily = dailySeries(iMap, function(k) {
    return { date: k, intake_kcal: iMap[k] || 0 };
  });
  const goalPlans = getGoalPlansCached_(userId);
  const activePlan = goalPlans ? goalPlans.active_plan : null;
  let goalBanner = { show: false, message: "" };
  if (activePlan && activePlan.planned_end_date) {
    const endStr = String(activePlan.planned_end_date).slice(0, 10);
    if (endStr && to > endStr) {
      goalBanner = {
        show: true,
        message: "\u76EE\u6A19\u671F\u9593\u304C\u7D42\u4E86\u3057\u3066\u3044\u307E\u3059\u3002\u73FE\u5728\u306E\u4F53\u91CD\u30FB\u4F53\u7D44\u6210\u3092\u78BA\u8A8D\u3057\u3001\u5FC5\u8981\u306B\u5FDC\u3058\u3066\u76EE\u6A19\u3092\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      };
    }
  }
  return {
    range: { from, to },
    plan_limits: { range_days: isPremium ? null : 7 },
    latest_weight_kg: latestWeight,
    bmi,
    latest_bodycomp: latestBodycomp,
    weight_series: weightSeries,
    bodycomp_series: bodycompSeries,
    training_daily: trainingDaily,
    training_totals: trainingTotals,
    exercise_stats: exerciseStats,
    intake_daily: intakeDaily,
    goal_period_banner: goalBanner,
    notes: {
      volume: "\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0\u30DC\u30EA\u30E5\u30FC\u30E0\u306F\u91CD\u91CF\xD7\u56DE\u6570\u304B\u3089\u7B97\u51FA\u3057\u305F\u53C2\u8003\u5024\u3067\u3059\u3002\u8CA0\u8377\u306E\u9AD8\u3055\u305D\u306E\u3082\u306E\u3092\u793A\u3059\u6307\u6A19\u3067\u306F\u3042\u308A\u307E\u305B\u3093\uFF08\u4F8B: 60kg\xD710\u56DE\xD73\u30BB\u30C3\u30C8\u3088\u308A100kg\xD75\u56DE\xD73\u30BB\u30C3\u30C8\u306E\u65B9\u304C\u9AD8\u5F37\u5EA6\u306A\u5834\u5408\u304C\u3042\u308A\u307E\u3059\uFF09\u3002",
      bodyweight: "\u81EA\u91CD\u7A2E\u76EE\u306F\u91CD\u91CF\u3092\u8A18\u9332\u3057\u306A\u3044\u305F\u3081\u3001\u30DC\u30EA\u30E5\u30FC\u30E0\u306B\u306F\u542B\u307E\u308C\u307E\u305B\u3093\u3002\u56DE\u6570\u30FB\u30BB\u30C3\u30C8\u6570\u306F\u96C6\u8A08\u3055\u308C\u307E\u3059\u3002",
      bodycomp: "\u6E2C\u5B9A\u3057\u305F\u65E5\u306E\u5024\u3092\u8868\u793A\u3057\u3066\u3044\u307E\u3059\u3002\u6E2C\u5B9A\u3057\u3066\u3044\u306A\u3044\u65E5\u306E\u5909\u5316\u306F\u8868\u793A\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u4F53\u7D44\u6210\u306E\u5024\u306F\u6E2C\u5B9A\u6761\u4EF6\u306B\u3088\u3063\u3066\u5909\u52D5\u3059\u308B\u305F\u3081\u3001\u9577\u671F\u7684\u306A\u50BE\u5411\u3092\u898B\u308B\u305F\u3081\u306E\u53C2\u8003\u5024\u3067\u3059\u3002",
      exercise: "\u63A8\u5B9A\u6D88\u8CBB\u30AB\u30ED\u30EA\u30FC\u306F\u53C2\u8003\u5024\u306E\u5408\u8A08\u3067\u3059\u3002\u5B9F\u969B\u306E\u6D88\u8CBB\u30AB\u30ED\u30EA\u30FC\u3068\u306F\u7570\u306A\u308B\u5834\u5408\u304C\u3042\u308A\u307E\u3059\u3002",
      intake: "\u6442\u53D6\u3068\u904B\u52D5\u6D88\u8CBB\u306F\u76F8\u6BBA\u3055\u308C\u307E\u305B\u3093\u3002",
      disclaimer: "\u76EE\u6A19\u9054\u6210\u5EA6\u304A\u3088\u3073\u8868\u793A\u306F\u73FE\u5728\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u308B\u76EE\u6A19\u30D7\u30E9\u30F3\u306B\u57FA\u3065\u304F\u53C2\u8003\u5024\u3067\u3059\u3002"
    }
  };
}
var G_ANIMAL_LADDER = [
  { kg: 1e3, label: "\u{1F697} 1t" },
  { kg: 5e3, label: "\u{1F418} 5t" },
  { kg: 8e3, label: "\u{1F9A3} 8t" },
  { kg: 3e4, label: "\u{1F40B} 30t" },
  { kg: 1e5, label: "\u{1F433} 100t" }
];
var G_DIST_LADDER = [
  { km: 10, label: "10km" },
  { km: 21.1, label: "21.1km\uFF08\u30CF\u30FC\u30D5\u30DE\u30E9\u30BD\u30F3\uFF09" },
  { km: 30, label: "30km\uFF08\u6771\u4EAC\u2192\u3055\u3044\u305F\u307E\u76F8\u5F53\uFF09" },
  { km: 34.5, label: "34.5km\uFF08\u5C71\u624B\u7DDA1\u5468\u76F8\u5F53\uFF09" },
  { km: 42.195, label: "42.195km\uFF08\u30D5\u30EB\u30DE\u30E9\u30BD\u30F3\uFF09" },
  { km: 100, label: "100km" }
];
function gBounds_(range) {
  const to = todayKey_();
  let from = null;
  if (range === "7d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 6);
    from = dateKeyOf_(d);
  } else if (range === "30d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 29);
    from = dateKeyOf_(d);
  } else if (range === "90d") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 89);
    from = dateKeyOf_(d);
  } else if (range === "1y") {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 364);
    from = dateKeyOf_(d);
  }
  return { from, to };
}
function gIn_(k, b) {
  return (!b.from || k >= b.from) && k <= b.to;
}
function gBucket_(k, weekly) {
  if (!weekly) return k;
  const d = /* @__PURE__ */ new Date(k + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return dateKeyOf_(d);
}
function gKey_(l) {
  const mid = String(l["master_id"] || "");
  return mid !== "" ? mid : String(l["exercise_name_snapshot"]);
}
function gKeyName_(key) {
  const m = findById2("Training_Master", "master_id", key);
  return m ? String(m["exercise_name"]) : key;
}
function gBodyPart_(key) {
  const m = findById2("Training_Master", "master_id", key);
  return m ? String(m["body_part"] || "other") : null;
}
function masterIdOrNull_(key) {
  return findById2("Training_Master", "master_id", key) ? key : null;
}
function gHistoricalWeight_(bLogs, dateKey) {
  let bestK = null, bestW = null, bestC = null;
  bLogs.forEach(function(r) {
    const w = toNumber_(r["weight_kg"], null);
    if (w === null) return;
    const k = dateKeyOf_(new Date(r["measured_at"]));
    if (k > dateKey) return;
    const c = String(r["created_at"]);
    if (bestK === null || k > bestK || k === bestK && c > bestC) {
      bestK = k;
      bestW = w;
      bestC = c;
    }
  });
  return bestW;
}
function gSetsByLog_(tSets) {
  const m = {};
  tSets.forEach(function(s) {
    const id = String(s["training_log_id"]);
    (m[id] = m[id] || []).push(s);
  });
  return m;
}
function gCardioType_(name) {
  const n = String(name);
  if (n.indexOf("\u30E9\u30F3") !== -1 || /run/i.test(n)) return "running";
  if (n.indexOf("\u30A6\u30A9\u30FC\u30AF") !== -1 || n.indexOf("\u6563\u6B69") !== -1 || /walk/i.test(n)) return "walking";
  if (n.indexOf("\u30B5\u30A4\u30AF\u30EA") !== -1 || n.indexOf("\u30D0\u30A4\u30AF") !== -1 || /cycl/i.test(n)) return "cycling";
  return "other";
}
function gVolumeOfSets_(sets) {
  let v = 0;
  (sets || []).forEach(function(s) {
    const w = toNumber_(s["weight_kg"], null);
    const reps = toNumber_(s["reps"], 0) || 0;
    if (w !== null && w > 0) v += w * reps;
  });
  return v;
}
function gTopWeightedKeys_(userId, n) {
  const logs = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const ids = {};
  logs.forEach(function(l) {
    ids[String(l["training_log_id"])] = true;
  });
  const weighted = {};
  getRows2("Training_Sets", function(s) {
    return !!ids[String(s["training_log_id"])];
  }).forEach(function(s) {
    const w = toNumber_(s["weight_kg"], null);
    if (w !== null && w > 0) weighted[String(s["training_log_id"])] = true;
  });
  const count = {}, last = {};
  logs.forEach(function(l) {
    if (!weighted[String(l["training_log_id"])]) return;
    const k = gKey_(l);
    count[k] = (count[k] || 0) + 1;
    const d = dateKeyOf_(new Date(l["training_date"]));
    if (!last[k] || d > last[k]) last[k] = d;
  });
  return Object.keys(count).map(function(k) {
    return { key: k, count: count[k], last: last[k] };
  }).sort(function(a, b) {
    return b.count - a.count || (a.last < b.last ? 1 : -1);
  }).slice(0, n);
}
function gRepresentativeKey_(userId) {
  const top = gTopWeightedKeys_(userId, 1);
  return top.length ? top[0].key : null;
}
function calculateExercisePrGrowth1rm_(userId, exerciseKey, range) {
  const logs = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId) && gKey_(r) === exerciseKey;
  }).sort(function(a, b2) {
    return new Date(a["training_date"]) - new Date(b2["training_date"]);
  });
  if (!logs.length) return null;
  const ids = {};
  logs.forEach(function(l) {
    ids[String(l["training_log_id"])] = true;
  });
  const setsByLog = gSetsByLog_(getRows2("Training_Sets", function(s) {
    return !!ids[String(s["training_log_id"])];
  }));
  const b = gBounds_(range || "all");
  let prWeight = null, prDate = null, initialWeight = null, initialDone = false, maxBefore = null;
  const epley = {};
  logs.forEach(function(l) {
    const k = dateKeyOf_(new Date(l["training_date"]));
    const ls = setsByLog[String(l["training_log_id"])] || [];
    let logMax = null;
    ls.forEach(function(s) {
      const w = toNumber_(s["weight_kg"], null);
      if (w === null || w <= 0) return;
      if (!initialDone) logMax = logMax === null || w > logMax ? w : logMax;
      if (prWeight === null || w > prWeight) {
        prWeight = w;
        prDate = k;
      }
      if (b.from && k < b.from) {
        if (maxBefore === null || w > maxBefore) maxBefore = w;
      }
      const reps = toNumber_(s["reps"], 0) || 0;
      if (reps >= 1 && reps <= 12) {
        const e = Math.round(w * (1 + reps / 30) * 10) / 10;
        if (!epley[k] || e > epley[k]) epley[k] = e;
      }
    });
    if (!initialDone && logMax !== null) {
      initialWeight = logMax;
      initialDone = true;
    }
  });
  const inRange = prDate !== null && gIn_(prDate, b);
  return {
    exercise_key: exerciseKey,
    exercise_name: gKeyName_(exerciseKey),
    pr_weight: prWeight,
    pr_date: prDate,
    is_new_pr_in_range: inRange && (maxBefore === null || prWeight > maxBefore),
    initial_weight: initialWeight,
    growth_percent: prWeight !== null && initialWeight ? Math.round((prWeight - initialWeight) / initialWeight * 1e3) / 10 : null,
    epley_series: Object.keys(epley).sort().map(function(k) {
      return { date: k, value: epley[k] };
    })
  };
}
function apiGetTrainingAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || "7d");
  if (["7d", "30d", "90d", "1y", "all"].indexOf(range) === -1) range = "7d";
  if (!user.isPremium) range = "7d";
  const tier = user.isPremium ? "p" : "f";
  const data = cached_("growth_training_" + userId + "_" + range + "_" + tier, 120, function() {
    return buildTrainingAnalysis_(userId, range);
  });
  return { ok: true, data };
}
function buildTrainingAnalysis_(userId, range) {
  const b = gBounds_(range);
  const tLogsAll = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const idsAll = {};
  tLogsAll.forEach(function(l) {
    idsAll[String(l["training_log_id"])] = true;
  });
  const setsByLog = gSetsByLog_(getRows2("Training_Sets", function(s) {
    return !!idsAll[String(s["training_log_id"])];
  }));
  const bLogs = getRows2("Body_Composition", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const mLogs = getRows2("logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const tLogs = tLogsAll.filter(function(l) {
    return gIn_(dateKeyOf_(new Date(l["training_date"])), b);
  });
  const blocks = {};
  function ready(k, d) {
    blocks[k] = { status: "ready", data: d };
  }
  function insuff(k) {
    blocks[k] = { status: "insufficient", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  function empty(k) {
    blocks[k] = { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  (function() {
    const strength = tLogs.filter(function(l) {
      return String(l["training_type"]) !== "cardio";
    });
    if (!strength.length) {
      empty("T1");
      return;
    }
    const agg = {};
    strength.forEach(function(l) {
      const part = gBodyPart_(gKey_(l)) || "\u672A\u767B\u9332";
      if (!agg[part]) agg[part] = { body_part: part, volume_kg: 0, exercise_logs: 0 };
      agg[part].exercise_logs += 1;
      agg[part].volume_kg += gVolumeOfSets_(setsByLog[String(l["training_log_id"])]);
    });
    ready("T1", Object.keys(agg).map(function(k) {
      return agg[k];
    }).sort(function(a, z) {
      return z.volume_kg - a.volume_kg;
    }));
  })();
  (function() {
    const cardio = tLogs.filter(function(l) {
      return String(l["training_type"]) === "cardio";
    });
    if (!cardio.some(function(l) {
      return toNumber_(l["distance_km"], null) !== null;
    })) {
      empty("T2");
      return;
    }
    const agg = {};
    cardio.forEach(function(l) {
      const t = gCardioType_(l["exercise_name_snapshot"]);
      if (!agg[t]) agg[t] = { type: t, distance_km: 0, count: 0, duration_min: 0, recent: [] };
      const d = toNumber_(l["distance_km"], null);
      const dur = toNumber_(l["duration_min"], 0) || 0;
      if (d !== null) agg[t].distance_km += d;
      agg[t].count += 1;
      agg[t].duration_min += dur;
      agg[t].recent.push({ date: dateKeyOf_(new Date(l["training_date"])), distance_km: d, duration_min: dur });
    });
    ready("T2", Object.keys(agg).map(function(k) {
      const a = agg[k];
      a.recent.sort(function(x, y) {
        return x.date < y.date ? 1 : -1;
      });
      return {
        type: a.type,
        distance_km: Math.round(a.distance_km * 100) / 100,
        count: a.count,
        duration_min: a.duration_min,
        avg_pace: a.distance_km > 0 && a.duration_min > 0 ? Math.round(a.duration_min / a.distance_km * 100) / 100 : null,
        recent: a.recent.slice(0, 5).map(function(r) {
          return {
            date: r.date,
            distance_km: r.distance_km,
            duration_min: r.duration_min,
            pace: r.distance_km && r.duration_min ? Math.round(r.duration_min / r.distance_km * 100) / 100 : null
          };
        })
      };
    }));
  })();
  (function() {
    const repKey = gRepresentativeKey_(userId);
    if (!repKey) {
      insuff("T4");
      insuff("T5");
      insuff("T6");
      return;
    }
    const calc = calculateExercisePrGrowth1rm_(userId, repKey, range);
    if (!calc || calc.pr_weight === null) {
      insuff("T4");
      insuff("T5");
      insuff("T6");
      return;
    }
    ready("T4", { name: calc.exercise_name, pr_weight: calc.pr_weight, pr_date: calc.pr_date, is_new_pr_in_range: calc.is_new_pr_in_range });
    if (calc.growth_percent === null) insuff("T5");
    else ready("T5", { name: calc.exercise_name, initial_weight: calc.initial_weight, pr_weight: calc.pr_weight, growth_percent: calc.growth_percent });
    const multi = gTopWeightedKeys_(userId, 3).map(function(t) {
      const c = calculateExercisePrGrowth1rm_(userId, t.key, range);
      return c && c.epley_series.length >= 2 ? { name: c.exercise_name, series: c.epley_series } : null;
    }).filter(function(x) {
      return x !== null;
    });
    if (multi.length) ready("T6", multi);
    else insuff("T6");
  })();
  (function() {
    const weeks = {};
    tLogs.forEach(function(l) {
      if (String(l["training_type"]) === "cardio") return;
      const wk = gBucket_(dateKeyOf_(new Date(l["training_date"])), true);
      if (!weeks[wk]) weeks[wk] = 0;
      weeks[wk] += gVolumeOfSets_(setsByLog[String(l["training_log_id"])]);
    });
    const wks = Object.keys(weeks).sort();
    if (!wks.length) {
      empty("T7");
      return;
    }
    const volume_series = wks.map(function(wk, i) {
      const prev = i > 0 ? weeks[wks[i - 1]] : null;
      return {
        date: wk,
        volume_kg: weeks[wk],
        wow_percent: prev && prev > 0 ? Math.round((weeks[wk] - prev) / prev * 1e3) / 10 : null
      };
    });
    const wbw = {};
    bLogs.forEach(function(r) {
      const w = toNumber_(r["weight_kg"], null);
      if (w === null) return;
      const wk = gBucket_(dateKeyOf_(new Date(r["measured_at"])), true);
      if (!wbw[wk] || new Date(r["measured_at"]) > new Date(wbw[wk].raw)) wbw[wk] = { raw: r["measured_at"], w };
    });
    ready("T7", {
      volume_series,
      weight_series: Object.keys(wbw).sort().map(function(wk) {
        return { date: wk, weight_kg: wbw[wk].w };
      })
    });
  })();
  (function() {
    const days = {};
    tLogs.forEach(function(l) {
      if (String(l["training_type"]) !== "cardio") return;
      const dur = toNumber_(l["duration_min"], 0) || 0;
      if (dur <= 0) return;
      const k = dateKeyOf_(new Date(l["training_date"]));
      if (!days[k]) days[k] = { duration_min: 0, estimated_kcal: 0 };
      days[k].duration_min += dur;
      days[k].estimated_kcal += toNumber_(l["estimated_calories"], 0) || 0;
    });
    const ks = Object.keys(days).sort();
    if (!ks.length) {
      empty("T8");
      return;
    }
    ready("T8", ks.map(function(k) {
      return { date: k, duration_min: days[k].duration_min, estimated_kcal: days[k].estimated_kcal };
    }));
  })();
  (function() {
    let vol = 0, dur = 0;
    const daily = {};
    tLogs.forEach(function(l) {
      if (String(l["training_type"]) === "cardio") return;
      const d = toNumber_(l["duration_min"], 0) || 0;
      if (d <= 0) return;
      const v = gVolumeOfSets_(setsByLog[String(l["training_log_id"])]);
      vol += v;
      dur += d;
      const k = dateKeyOf_(new Date(l["training_date"]));
      if (!daily[k]) daily[k] = { v: 0, d: 0 };
      daily[k].v += v;
      daily[k].d += d;
    });
    if (dur <= 0) {
      insuff("T9");
      return;
    }
    let best = null;
    Object.keys(daily).forEach(function(k) {
      const rate = daily[k].d > 0 ? daily[k].v / daily[k].d : 0;
      if (!best || rate > best.rate) best = { date: k, rate: Math.round(rate * 10) / 10 };
    });
    ready("T9", { density_kg_per_min: Math.round(vol / dur * 10) / 10, best_day: best });
  })();
  (function() {
    let total = 0;
    tLogsAll.forEach(function(l) {
      if (String(l["training_type"]) === "cardio") return;
      total += gVolumeOfSets_(setsByLog[String(l["training_log_id"])]);
    });
    if (total <= 0) {
      empty("T10");
      return;
    }
    let achieved = null, next = null;
    G_ANIMAL_LADDER.forEach(function(st) {
      if (total >= st.kg) achieved = st.label;
      if (!next && total < st.kg) next = st.label;
    });
    ready("T10", { total_kg: total, total_t: Math.round(total / 100) / 10, achieved, next });
  })();
  (function() {
    let total = 0;
    tLogsAll.forEach(function(l) {
      if (String(l["training_type"]) !== "cardio") return;
      if (gCardioType_(l["exercise_name_snapshot"]) === "cycling") return;
      const d = toNumber_(l["distance_km"], null);
      if (d !== null) total += d;
    });
    if (total <= 0) {
      empty("T11");
      return;
    }
    let achieved = null, next = null;
    G_DIST_LADDER.forEach(function(st) {
      if (total >= st.km) achieved = st.label;
      if (!next && total < st.km) next = st.label;
    });
    ready("T11", { total_km: Math.round(total * 100) / 100, achieved, next });
  })();
  (function() {
    const days = {};
    tLogsAll.forEach(function(l) {
      days[dateKeyOf_(new Date(l["training_date"]))] = true;
    });
    const weekSet = {};
    Object.keys(days).forEach(function(k) {
      weekSet[gBucket_(k, true)] = true;
    });
    if (!Object.keys(weekSet).length) {
      empty("T12");
      return;
    }
    const thisWeek = gBucket_(todayKey_(), true);
    let current = 0;
    if (weekSet[thisWeek]) {
      let p = thisWeek;
      while (weekSet[p]) {
        current += 1;
        const d = /* @__PURE__ */ new Date(p + "T00:00:00");
        d.setDate(d.getDate() - 7);
        p = dateKeyOf_(d);
      }
    }
    let longest = 0;
    Object.keys(weekSet).forEach(function(wk) {
      const d = /* @__PURE__ */ new Date(wk + "T00:00:00");
      d.setDate(d.getDate() - 7);
      if (weekSet[dateKeyOf_(d)]) return;
      let len = 0, q = wk;
      while (weekSet[q]) {
        len += 1;
        const dd = /* @__PURE__ */ new Date(q + "T00:00:00");
        dd.setDate(dd.getDate() + 7);
        q = dateKeyOf_(dd);
      }
      if (len > longest) longest = len;
    });
    ready("T12", { current_weeks: current, longest_weeks: longest });
  })();
  (function() {
    const now = /* @__PURE__ */ new Date(`${todayKey_().slice(0, 7)}-01T00:00:00+09:00`);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    const counts = {};
    months.forEach(function(m) {
      counts[m] = {};
    });
    tLogsAll.forEach(function(l) {
      const k = dateKeyOf_(new Date(l["training_date"]));
      const m = k.slice(0, 7);
      if (counts[m]) counts[m][k] = true;
    });
    if (!months.some(function(m) {
      return Object.keys(counts[m]).length > 0;
    })) {
      empty("T13");
      return;
    }
    ready("T13", months.map(function(m) {
      return { month: m, days: Object.keys(counts[m]).length, in_progress: m === months[5] };
    }));
  })();
  (function() {
    const list = tLogsAll.filter(function(l) {
      return String(l["memo"] || "").trim() !== "";
    }).sort(function(a, z) {
      return new Date(z["training_date"]) - new Date(a["training_date"]);
    }).slice(0, 10).map(function(l) {
      return { date: dateKeyOf_(new Date(l["training_date"])), name: String(l["exercise_name_snapshot"]), memo: String(l["memo"]).replace(/\n/g, " ") };
    });
    if (!list.length) {
      empty("T14");
      return;
    }
    ready("T14", list);
  })();
  (function() {
    const sum = {}, cnt = {};
    tLogsAll.forEach(function(l) {
      const wk = gBucket_(dateKeyOf_(new Date(l["training_date"])), true);
      const ls = setsByLog[String(l["training_log_id"])] || [];
      let vals = [];
      ls.forEach(function(s) {
        const r = toNumber_(s["rpe"], null);
        if (r !== null) vals.push(r);
      });
      if (!vals.length) {
        const lr = toNumber_(l["rpe"], null);
        if (lr !== null) vals.push(lr);
      }
      vals.forEach(function(v) {
        sum[wk] = (sum[wk] || 0) + v;
        cnt[wk] = (cnt[wk] || 0) + 1;
      });
    });
    const weeks = Object.keys(cnt);
    const total = weeks.reduce(function(s, w) {
      return s + cnt[w];
    }, 0);
    if (total < 3 || weeks.length < 2) {
      insuff("T15");
      return;
    }
    ready("T15", weeks.sort().map(function(wk) {
      return { date: wk, avg_rpe: Math.round(sum[wk] / cnt[wk] * 10) / 10 };
    }));
  })();
  (function() {
    const byKey = {};
    tLogsAll.forEach(function(l) {
      const ls = setsByLog[String(l["training_log_id"])] || [];
      let wMax = null;
      const rpes = [];
      ls.forEach(function(s) {
        const w = toNumber_(s["weight_kg"], null);
        if (w !== null && w > 0) wMax = wMax === null || w > wMax ? w : wMax;
        const r = toNumber_(s["rpe"], null);
        if (r !== null) rpes.push(r);
      });
      if (!rpes.length) {
        const lr = toNumber_(l["rpe"], null);
        if (lr !== null) rpes.push(lr);
      }
      if (wMax === null || !rpes.length) return;
      (byKey[gKey_(l)] = byKey[gKey_(l)] || []).push({
        date: dateKeyOf_(new Date(l["training_date"])),
        weight: wMax,
        avg: rpes.reduce(function(a, x) {
          return a + x;
        }, 0) / rpes.length
      });
    });
    const out = [];
    Object.keys(byKey).forEach(function(key) {
      const arr = byKey[key].sort(function(a, z) {
        return a.date < z.date ? -1 : 1;
      });
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].weight === arr[i - 1].weight) {
          const delta = Math.round((arr[i].avg - arr[i - 1].avg) * 10) / 10;
          if (delta >= 2) out.push({
            name: gKeyName_(key),
            weight: arr[i].weight,
            prev_rpe: Math.round(arr[i - 1].avg * 10) / 10,
            curr_rpe: Math.round(arr[i].avg * 10) / 10,
            delta,
            date: arr[i].date
          });
        }
      }
    });
    if (!out.length) {
      empty("T16");
      return;
    }
    out.sort(function(a, z) {
      return a.date < z.date ? 1 : -1;
    });
    ready("T16", out.slice(0, 10));
  })();
  (function() {
    const repKey = gRepresentativeKey_(userId);
    if (!repKey) {
      insuff("T17");
      return;
    }
    const pts = [];
    tLogsAll.forEach(function(l) {
      if (gKey_(l) !== repKey) return;
      let wMax = null;
      (setsByLog[String(l["training_log_id"])] || []).forEach(function(s) {
        const w = toNumber_(s["weight_kg"], null);
        if (w !== null && w > 0) wMax = wMax === null || w > wMax ? w : wMax;
      });
      if (wMax === null) return;
      const k = dateKeyOf_(new Date(l["training_date"]));
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      pts.push({ date: k, value: Math.round(wMax / hw * 100) / 100 });
    });
    pts.sort(function(a, z) {
      return a.date < z.date ? -1 : 1;
    });
    if (pts.length < 2) {
      insuff("T17");
      return;
    }
    ready("T17", { name: gKeyName_(repKey), series: pts });
  })();
  const glance = buildGlanceBlocks_(tLogsAll, setsByLog, mLogs);
  Object.keys(glance).forEach(function(k) {
    blocks[k] = glance[k];
  });
  (function() {
    const nowM = todayKey_().slice(0, 7);
    const days = {};
    let vol = 0;
    tLogsAll.forEach(function(l) {
      if (dateKeyOf_(new Date(l["training_date"])).slice(0, 7) !== nowM) return;
      days[dateKeyOf_(new Date(l["training_date"]))] = true;
      if (String(l["training_type"]) !== "cardio") vol += gVolumeOfSets_(setsByLog[String(l["training_log_id"])]);
    });
    const wVals = bLogs.filter(function(r) {
      return dateKeyOf_(new Date(r["measured_at"])).slice(0, 7) === nowM;
    }).sort(function(a, z) {
      return new Date(a["measured_at"]) - new Date(z["measured_at"]);
    }).map(function(r) {
      return toNumber_(r["weight_kg"], null);
    }).filter(function(w) {
      return w !== null;
    });
    const weightChange = wVals.length >= 2 ? Math.round((wVals[wVals.length - 1] - wVals[0]) * 10) / 10 : null;
    const byDay = {};
    mLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r["timestamp"]));
      if (k.slice(0, 7) !== nowM) return;
      byDay[k] = (byDay[k] || 0) + (Number(r["calories"]) || 0);
    });
    const dv = Object.keys(byDay).map(function(k) {
      return byDay[k];
    });
    const avgIntake = dv.length ? Math.round(dv.reduce(function(a, x) {
      return a + x;
    }, 0) / dv.length) : null;
    const daysCount = Object.keys(days).length;
    if (!daysCount && avgIntake === null && weightChange === null) {
      empty("O1");
      return;
    }
    ready("O1", {
      month: nowM,
      training_days: daysCount,
      volume_kg: vol,
      elephant: vol > 0 ? Math.round(vol / 5e3 * 100) / 100 : null,
      weight_change: weightChange,
      avg_intake: avgIntake,
      in_progress: true
    });
  })();
  return { range, blocks };
}
function apiGetMenuTrajectory(userId, params) {
  const masterId = String(params.master_id || "");
  const name = String(params.exercise_name_snapshot || "");
  const key = masterId !== "" ? masterId : name;
  if (key === "") return { ok: false, error: { code: "VALIDATION_ERROR", message: "\u7A2E\u76EE\u304C\u6307\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093" } };
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key).map(function(bt) {
    return ("0" + (bt + 256) % 256).toString(16).slice(-2);
  }).join("");
  const data = cached_("growth_trajectory_" + userId + "_" + hash, 120, function() {
    return buildTrajectory_(userId, key);
  });
  return { ok: true, data };
}
function buildTrajectory_(userId, key) {
  const logs = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId) && gKey_(r) === key;
  }).sort(function(a, b) {
    return new Date(a["training_date"]) - new Date(b["training_date"]);
  });
  const base = { exercise: { master_id: masterIdOrNull_(key), exercise_name: gKeyName_(key) } };
  if (!logs.length) return { exercise: base.exercise, sessions: [], header: null };
  const ids = {};
  logs.forEach(function(l) {
    ids[String(l["training_log_id"])] = true;
  });
  const setsByLog = gSetsByLog_(getRows2("Training_Sets", function(s) {
    return !!ids[String(s["training_log_id"])];
  }));
  const sessions = logs.slice(-6).map(function(l) {
    return {
      date: dateKeyOf_(new Date(l["training_date"])),
      duration_min: toNumber_(l["duration_min"], null),
      distance_km: toNumber_(l["distance_km"], null),
      sets: (setsByLog[String(l["training_log_id"])] || []).sort(function(a, b) {
        return (Number(a["set_no"]) || 0) - (Number(b["set_no"]) || 0);
      }).slice(0, 6).map(function(s) {
        const w = toNumber_(s["weight_kg"], null);
        const bw = toBool_(s["is_bodyweight"]);
        const reps = toNumber_(s["reps"], 0) || 0;
        return {
          set_no: Number(s["set_no"]) || 0,
          weight_kg: w,
          reps,
          is_bodyweight: bw,
          display: bw ? "\u81EA\u91CD \xD7 " + reps : w !== null ? w + "kg \xD7 " + reps : "\xD7 " + reps,
          weight_up: false
        };
      })
    };
  });
  for (let i = 1; i < sessions.length; i++) {
    sessions[i].sets.forEach(function(st) {
      if (st.is_bodyweight) {
        st.weight_up = false;
        return;
      }
      const prev = sessions[i - 1].sets.filter(function(p) {
        return p.set_no === st.set_no;
      })[0];
      if (prev && !prev.is_bodyweight && st.weight_kg !== null && prev.weight_kg !== null && st.weight_kg > prev.weight_kg) st.weight_up = true;
    });
  }
  return { exercise: base.exercise, sessions, header: calculateExercisePrGrowth1rm_(userId, key, "all") };
}
function gLinRegSlope_(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  pts.forEach(function(p) {
    sx += p.x;
    sy += p.y;
    sxy += p.x * p.y;
    sxx += p.x * p.x;
  });
  const denom = n * sxx - sx * sx;
  if (!denom) return null;
  return (n * sxy - sx * sy) / denom;
}
function apiGetMealAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || "7d");
  if (["7d", "30d", "90d", "1y", "all"].indexOf(range) === -1) range = "7d";
  if (!user.isPremium) range = "7d";
  const tier = user.isPremium ? "p" : "f";
  const data = cached_("growth_meal_" + userId + "_" + range + "_" + tier, 120, function() {
    return buildMealAnalysis_(userId, range);
  });
  return { ok: true, data };
}
function buildMealAnalysis_(userId, range) {
  const b = gBounds_(range);
  const mLogs = getRows2("logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const tLogsAll = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const bLogs = getRows2("Body_Composition", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const trainDays = {};
  tLogsAll.forEach(function(l) {
    trainDays[dateKeyOf_(new Date(l["training_date"]))] = true;
  });
  const byDay = {};
  mLogs.forEach(function(r) {
    const k = dateKeyOf_(new Date(r["timestamp"]));
    if (!gIn_(k, b)) return;
    if (!byDay[k]) byDay[k] = { kcal: 0, protein: 0, ge20: 0 };
    byDay[k].kcal += Number(r["calories"]) || 0;
    byDay[k].protein += Number(r["protein"]) || 0;
    if ((Number(r["protein"]) || 0) >= 20) byDay[k].ge20 += 1;
  });
  const dayKeys = Object.keys(byDay).sort();
  const blocks = {};
  function ready(k, d) {
    blocks[k] = { status: "ready", data: d };
  }
  function insuff(k) {
    blocks[k] = { status: "insufficient", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  function empty(k) {
    blocks[k] = { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  (function() {
    const tr = { kcal: [], p: [] }, re = { kcal: [], p: [] };
    dayKeys.forEach(function(k) {
      const g = trainDays[k] ? tr : re;
      g.kcal.push(byDay[k].kcal);
      g.p.push(byDay[k].protein);
    });
    if (tr.kcal.length < 3 || re.kcal.length < 3) {
      insuff("M0");
      return;
    }
    const avg = function(a) {
      return Math.round(a.reduce(function(x, y) {
        return x + y;
      }, 0) / a.length);
    };
    ready("M0", {
      training_days: { days: tr.kcal.length, avg_kcal: avg(tr.kcal), avg_protein: avg(tr.p) },
      rest_days: { days: re.kcal.length, avg_kcal: avg(re.kcal), avg_protein: avg(re.p) }
    });
  })();
  (function() {
    const c = { morning: 0, noon: 0, evening: 0, night: 0 };
    let any = false;
    mLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r["timestamp"]));
      if (!gIn_(k, b)) return;
      any = true;
      const h = jstHour_(r["timestamp"]);
      if (h >= 5 && h <= 9) c.morning += 1;
      else if (h >= 10 && h <= 16) c.noon += 1;
      else if (h >= 17 && h <= 20) c.evening += 1;
      else c.night += 1;
    });
    if (!any) {
      empty("M3");
      return;
    }
    ready("M3", c);
  })();
  (function() {
    if (dayKeys.length < 3) {
      insuff("M4");
      return;
    }
    const vals = dayKeys.map(function(k) {
      return byDay[k].kcal;
    });
    const mean = vals.reduce(function(a, x) {
      return a + x;
    }, 0) / vals.length;
    const sd = Math.round(Math.sqrt(vals.reduce(function(a, x) {
      return a + (x - mean) * (x - mean);
    }, 0) / vals.length));
    ready("M4", { sd_kcal: sd, label: sd < 200 ? "\u5B89\u5B9A" : sd < 400 ? "\u666E\u901A" : "\u5909\u52D5\u5927\u304D\u3081" });
  })();
  (function() {
    const series = [];
    dayKeys.forEach(function(k) {
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      series.push({ date: k, value: Math.round(byDay[k].protein / hw * 100) / 100 });
    });
    if (series.length < 3) {
      insuff("M6");
      return;
    }
    ready("M6", series);
  })();
  (function() {
    if (!dayKeys.length) {
      empty("M7");
      return;
    }
    const totalGe = dayKeys.reduce(function(s, k) {
      return s + byDay[k].ge20;
    }, 0);
    const recent = mLogs.filter(function(r) {
      return (Number(r["protein"]) || 0) >= 20 && gIn_(dateKeyOf_(new Date(r["timestamp"])), b);
    }).sort(function(a, z) {
      return String(z["timestamp"]).localeCompare(String(a["timestamp"]));
    }).slice(0, 10).map(function(r) {
      return { date: dateKeyOf_(new Date(r["timestamp"])), menu_name: String(r["menu_name"] || "").slice(0, 12), protein: Number(r["protein"]) || 0 };
    });
    ready("M7", { avg_per_day: Math.round(totalGe / dayKeys.length * 100) / 100, recent });
  })();
  (function() {
    const distByDay = {};
    tLogsAll.forEach(function(l) {
      if (String(l["training_type"]) !== "cardio") return;
      if (gCardioType_(l["exercise_name_snapshot"]) === "cycling") return;
      const d = toNumber_(l["distance_km"], null);
      if (d === null) return;
      const k = dateKeyOf_(new Date(l["training_date"]));
      distByDay[k] = (distByDay[k] || 0) + d;
    });
    const L = [], O = [];
    dayKeys.forEach(function(k) {
      ((distByDay[k] || 0) >= 10 ? L : O).push(k);
    });
    if (L.length < 3 || O.length < 3) {
      insuff("M10");
      return;
    }
    const avgOf = function(ks) {
      return Math.round(ks.reduce(function(s, k) {
        return s + byDay[k].kcal;
      }, 0) / ks.length);
    };
    ready("M10", { long_days: { days: L.length, avg_kcal: avgOf(L) }, other_days: { days: O.length, avg_kcal: avgOf(O) } });
  })();
  (function() {
    let achieved = 0, valid = 0;
    dayKeys.forEach(function(k) {
      const hw = gHistoricalWeight_(bLogs, k);
      if (hw === null || hw <= 0) return;
      valid += 1;
      if (byDay[k].protein >= 1.6 * hw) achieved += 1;
    });
    if (!valid) {
      insuff("M12");
      return;
    }
    ready("M12", { achieved_days: achieved, valid_days: valid });
  })();
  (function() {
    const periodDays = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : null;
    const trSet = {};
    let trDays = 0;
    tLogsAll.forEach(function(l) {
      const k = dateKeyOf_(new Date(l["training_date"]));
      if (gIn_(k, b) && !trSet[k]) {
        trSet[k] = true;
        trDays += 1;
      }
    });
    const bwSet = {};
    let bwDays = 0;
    bLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r["measured_at"]));
      if (gIn_(k, b) && !bwSet[k]) {
        bwSet[k] = true;
        bwDays += 1;
      }
    });
    ready("M13", { period_days: periodDays, meal_days: dayKeys.length, training_days: trDays, weight_days: bwDays });
  })();
  (function() {
    const goalPlans = getGoalPlansCached_(userId);
    const activePlan = goalPlans ? goalPlans.active_plan : null;
    if (!activePlan) {
      blocks["M5"] = { status: "insufficient", message: "\u76EE\u6A19\u30D7\u30E9\u30F3\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093", code: "no_active_plan" };
      return;
    }
    const planStart = String(activePlan["start_date"] || "").slice(0, 10);
    const winFrom = b.from && planStart ? planStart > b.from ? planStart : b.from : planStart || b.from;
    const winTo = b.to;
    if (!winFrom || winFrom > winTo) {
      insuff("M5");
      return;
    }
    const targetKcal = toNumber_(activePlan["planned_target_calories"], null);
    if (!targetKcal || targetKcal <= 0) {
      insuff("M5");
      return;
    }
    const dates = [];
    const cur = /* @__PURE__ */ new Date(winFrom + "T00:00:00");
    const end = /* @__PURE__ */ new Date(winTo + "T00:00:00");
    while (cur <= end) {
      dates.push(dateKeyOf_(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const validDays = dates.length;
    if (validDays === 0) {
      insuff("M5");
      return;
    }
    const winDayMap = {};
    let totalIntake = 0;
    let recordedDays = 0;
    mLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r["timestamp"]));
      if (k >= winFrom && k <= winTo) {
        winDayMap[k] = (winDayMap[k] || 0) + (Number(r["calories"]) || 0);
      }
    });
    dates.forEach(function(k) {
      const c = winDayMap[k] || 0;
      if (c > 0) recordedDays += 1;
      totalIntake += c;
    });
    if (recordedDays < 3) {
      insuff("M5");
      return;
    }
    const avgIntake = Math.round(totalIntake / validDays);
    const ratio = Math.round(avgIntake / targetKcal * 100);
    const displayRatio = Math.min(ratio, 200);
    let underDays = 0, withinDays = 0, overDays = 0;
    dates.forEach(function(k) {
      const c = winDayMap[k] || 0;
      const r = c / targetKcal * 100;
      if (r < 90) underDays += 1;
      else if (r <= 110) withinDays += 1;
      else overDays += 1;
    });
    ready("M5", {
      active_plan: activePlan,
      valid_days: validDays,
      recorded_days: recordedDays,
      avg_intake: avgIntake,
      target_calories: targetKcal,
      ratio,
      display_ratio: displayRatio,
      under_days: underDays,
      within_days: withinDays,
      over_days: overDays
    });
  })();
  return {
    range,
    notes: {
      meal_time: "\u6642\u9593\u5E2F\u306E\u5206\u985E\u306F\u8A18\u9332\u3055\u308C\u305F\u6642\u523B\u3092\u57FA\u6E96\u3068\u3057\u3066\u3044\u307E\u3059\u3002",
      stability: "\u8868\u793A\u533A\u5206\uFF08\xB1200/400 kcal\uFF09\u306F\u672C\u30A2\u30D7\u30EA\u5185\u306E\u5909\u52D5\u5E45\u3092\u76F4\u611F\u7684\u306B\u628A\u63E1\u3059\u308B\u305F\u3081\u306E\u8868\u793A\u57FA\u6E96\u3067\u3042\u308A\u3001\u533B\u5B66\u30FB\u6804\u990A\u5B66\u4E0A\u306E\u6A19\u6E96\u7684\u306A\u95BE\u5024\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      protein_approx: "\u30BF\u30F3\u30D1\u30AFg/kg\u306F\u4F53\u91CD\u6E2C\u5B9A\u65E5\u306E\u9593\u306F\u76F4\u8FD1\u6E2C\u5B9A\u5024\u3092\u4F7F\u7528\u3057\u305F\u8FD1\u4F3C\u5024\u3067\u3059\u3002",
      protein_ref: "1\u65E51.6g/kg\u3092\u76EE\u5B89\u3068\u3057\u3066\u96C6\u8A08\u3057\u305F\u53C2\u8003\u5024\u3067\u3059\u3002",
      goal_disclaimer: "\u76EE\u6A19\u6BD4\u306F\u73FE\u5728\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u308B\u76EE\u6A19\u30D7\u30E9\u30F3\u306B\u57FA\u3065\u304F\u53C2\u8003\u5024\u3067\u3059\u3002"
    },
    blocks
  };
}
function apiGetBodyAnalysis(userId, params) {
  const user = getUserRecord_(userId);
  let range = String(params.range || "7d");
  if (["7d", "30d", "90d", "1y", "all"].indexOf(range) === -1) range = "7d";
  if (!user.isPremium) range = "7d";
  const tier = user.isPremium ? "p" : "f";
  const data = cached_("growth_body_" + userId + "_" + range + "_" + tier, 120, function() {
    return buildBodyAnalysis_(userId, range, user);
  });
  return { ok: true, data };
}
function buildBodyAnalysis_(userId, range, user) {
  const b = gBounds_(range);
  const bLogs = getRows2("Body_Composition", function(r) {
    return String(r["user_id"]) === String(userId);
  }).sort(function(a, z) {
    return new Date(a["measured_at"]) - new Date(z["measured_at"]);
  });
  const inR = bLogs.filter(function(r) {
    return gIn_(dateKeyOf_(new Date(r["measured_at"])), b);
  });
  const mLogs = getRows2("logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const tLogsAll = getRows2("Training_Logs", function(r) {
    return String(r["user_id"]) === String(userId);
  });
  const blocks = {};
  function ready(k, d) {
    blocks[k] = { status: "ready", data: d };
  }
  function insuff(k) {
    blocks[k] = { status: "insufficient", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  function hidden(k, m) {
    blocks[k] = { status: "hidden", message: m };
  }
  const d28 = /* @__PURE__ */ new Date();
  d28.setDate(d28.getDate() - 27);
  const regLogs = bLogs.filter(function(r) {
    return toNumber_(r["weight_kg"], null) !== null && new Date(r["measured_at"]) >= d28;
  });
  let slope = null;
  if (regLogs.length >= 5) {
    const t0 = new Date(regLogs[0]["measured_at"]).getTime();
    slope = gLinRegSlope_(regLogs.map(function(r) {
      return { x: (new Date(r["measured_at"]).getTime() - t0) / 864e5, y: toNumber_(r["weight_kg"], null) };
    }));
  }
  (function() {
    if (slope === null) {
      insuff("B0a");
      return;
    }
    ready("B0a", { weekly_change: Math.round(slope * 7 * 10) / 10 });
  })();
  (function() {
    if (slope === null || !regLogs.length) {
      insuff("B3");
      return;
    }
    const latest = toNumber_(regLogs[regLogs.length - 1]["weight_kg"], null);
    ready("B3", {
      pace_per_week: Math.round(slope * 7 * 10) / 10,
      predicted_weight: Math.round((latest + slope * 28) * 10) / 10
    });
  })();
  (function() {
    const h = user.height;
    if (h === null || h <= 0 || !inR.length) {
      insuff("B1");
      return;
    }
    const list = [];
    inR.forEach(function(r) {
      const w = toNumber_(r["weight_kg"], null);
      if (w === null) return;
      const bmi = Math.round(w / (h / 100 * (h / 100)) * 10) / 10;
      list.push({
        date: dateKeyOf_(new Date(r["measured_at"])),
        bmi,
        band: bmi < 18.5 ? "\u4F4E\u4F53\u91CD" : bmi < 25 ? "\u666E\u901A\u4F53\u91CD" : "\u80A5\u6E80\u57DF"
      });
    });
    if (!list.length) {
      insuff("B1");
      return;
    }
    ready("B1", list);
  })();
  (function() {
    const curM = todayKey_().slice(0, 7);
    const now = /* @__PURE__ */ new Date(`${curM}-01T00:00:00+09:00`);
    const pd = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevM = pd.getFullYear() + "-" + String(pd.getMonth() + 1).padStart(2, "0");
    function monthAvg(m) {
      const perDay = {};
      bLogs.forEach(function(r) {
        const k = dateKeyOf_(new Date(r["measured_at"]));
        if (k.slice(0, 7) !== m) return;
        const w = toNumber_(r["weight_kg"], null);
        if (w !== null) perDay[k] = w;
      });
      const ks = Object.keys(perDay);
      if (ks.length < 3) return null;
      return Math.round(ks.reduce(function(s, k) {
        return s + perDay[k];
      }, 0) / ks.length * 10) / 10;
    }
    const cur = monthAvg(curM), prev = monthAvg(prevM);
    if (cur === null && prev === null) {
      insuff("B4");
      return;
    }
    ready("B4", {
      current_month: curM,
      current_avg: cur,
      previous_avg: prev,
      delta: cur !== null && prev !== null ? Math.round((cur - prev) * 10) / 10 : null,
      in_progress: true
    });
  })();
  (function() {
    const pts = [];
    inR.forEach(function(r) {
      const bf = toNumber_(r["body_fat_pct"], null);
      const sm = toNumber_(r["skeletal_muscle_kg"], null);
      if (bf !== null && sm !== null) pts.push({ body_fat_pct: bf, skeletal_muscle_kg: sm });
    });
    if (pts.length < 2) {
      insuff("B0b");
      return;
    }
    ready("B0b", pts);
  })();
  (function() {
    const series = [];
    inR.forEach(function(r) {
      const w = toNumber_(r["weight_kg"], null);
      const bf = toNumber_(r["body_fat_pct"], null);
      const sm = toNumber_(r["skeletal_muscle_kg"], null);
      if (w === null || bf === null || sm === null || bf <= 0) return;
      const fat = w * bf / 100;
      if (fat <= 0) return;
      series.push({ date: dateKeyOf_(new Date(r["measured_at"])), value: Math.round(sm / fat * 100) / 100 });
    });
    if (series.length < 2) {
      insuff("B6");
      return;
    }
    ready("B6", {
      series,
      delta: Math.round((series[series.length - 1].value - series[0].value) * 100) / 100
    });
  })();
  (function() {
    const HIDE_MSG = "BMR\u3092\u8A18\u9332\u3059\u308B\u3068\u6442\u53D6\u3068\u306E\u6BD4\u8F03\u304C\u4F7F\u3048\u307E\u3059\u3002";
    const hasBmr = bLogs.some(function(r) {
      return toNumber_(r["bmr"], null) !== null;
    });
    if (!hasBmr) {
      hidden("B7", HIDE_MSG);
      return;
    }
    const byDay = {};
    mLogs.forEach(function(r) {
      const k = dateKeyOf_(new Date(r["timestamp"]));
      if (!gIn_(k, b)) return;
      byDay[k] = (byDay[k] || 0) + (Number(r["calories"]) || 0);
    });
    let below = 0, checked = 0;
    Object.keys(byDay).forEach(function(k) {
      let bestK = null, bestBmr = null;
      bLogs.forEach(function(r) {
        const bmr = toNumber_(r["bmr"], null);
        if (bmr === null) return;
        const rk = dateKeyOf_(new Date(r["measured_at"]));
        if (rk > k) return;
        if (bestK === null || rk > bestK) {
          bestK = rk;
          bestBmr = bmr;
        }
      });
      if (bestBmr === null) return;
      checked += 1;
      if (byDay[k] < bestBmr) below += 1;
    });
    if (!checked) {
      hidden("B7", HIDE_MSG);
      return;
    }
    ready("B7", { below_days: below, checked_days: checked });
  })();
  (function() {
    const weight_series = [];
    inR.forEach(function(r) {
      const w = toNumber_(r["weight_kg"], null);
      if (w !== null) weight_series.push({ date: dateKeyOf_(new Date(r["measured_at"])), weight_kg: w });
    });
    if (!weight_series.length) {
      insuff("B9");
      return;
    }
    const paceByDay = {};
    tLogsAll.forEach(function(l) {
      if (String(l["training_type"]) !== "cardio") return;
      const t = gCardioType_(l["exercise_name_snapshot"]);
      if (t !== "running" && t !== "walking") return;
      const d = toNumber_(l["distance_km"], null);
      const dur = toNumber_(l["duration_min"], 0) || 0;
      if (d === null || d < 1 || dur <= 0) return;
      const k = dateKeyOf_(new Date(l["training_date"]));
      if (!gIn_(k, b)) return;
      if (!paceByDay[k]) paceByDay[k] = { d: 0, dur: 0 };
      paceByDay[k].d += d;
      paceByDay[k].dur += dur;
    });
    ready("B9", {
      weight_series,
      pace_series: Object.keys(paceByDay).sort().map(function(k) {
        return { date: k, pace: Math.round(paceByDay[k].dur / paceByDay[k].d * 100) / 100 };
      })
    });
  })();
  return {
    range,
    notes: {
      bmi: "BMI\u533A\u5206\u306F\u65E5\u672C\u80A5\u6E80\u5B66\u4F1A\u57FA\u6E96\uFF08\u4F4E\u4F53\u91CD<18.5 / \u666E\u901A\u4F53\u91CD18.5-25 / \u80A5\u6E80\u57DF\u226525\uFF09\u306E\u76EE\u5B89\u3067\u3042\u308A\u3001\u5065\u5EB7\u5EA6\u306E\u8A55\u4FA1\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u7B4B\u8089\u91CF\u304C\u591A\u3044\u5834\u5408\u306A\u3069\u3001BMI\u3060\u3051\u3067\u306F\u4F53\u8102\u80AA\u306E\u72B6\u614B\u3092\u6B63\u78BA\u306B\u8868\u3057\u307E\u305B\u3093\u3002",
      prediction: "\u4E88\u6E2C\u306F\u73FE\u5728\u306E\u50BE\u5411\u3092\u5358\u7D14\u5EF6\u9577\u3057\u305F\u53C2\u8003\u5024\u3067\u3059\u3002\u76EE\u6A19\u4F53\u91CD\u306E\u9054\u6210\u4E88\u6E2C\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      bmr: "BMR\u306F\u5B89\u9759\u6642\u306E\u63A8\u5B9A\u6D88\u8CBB\u91CF\u3067\u3042\u308A\u30011\u65E5\u306E\u5FC5\u8981\u6442\u53D6\u91CF\u305D\u306E\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002",
      ratio: "\u7B4B\u8089\u91CF/\u4F53\u8102\u80AA\u91CF\u6BD4\u306F\u53C2\u8003\u5024\u3067\u3042\u308A\u3001\u533B\u5B66\u7684\u306A\u5065\u5EB7\u6307\u6A19\u30FB\u8A55\u4FA1\u30B9\u30B3\u30A2\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"
    },
    blocks
  };
}
function buildGlanceBlocks_(tLogsAll, setsByLog, mLogs) {
  const blocks = {};
  function ready(k, d) {
    blocks[k] = { status: "ready", data: d };
  }
  function empty(k) {
    blocks[k] = { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  (function() {
    const t = todayKey_();
    const todayTr = tLogsAll.filter(function(l) {
      return dateKeyOf_(new Date(l["training_date"])) === t;
    }).sort(function(a, z) {
      return String(z["created_at"]).localeCompare(String(a["created_at"]));
    });
    if (todayTr.length) {
      const l = todayTr[0];
      const ls = setsByLog[String(l["training_log_id"])] || [];
      let txt = String(l["exercise_name_snapshot"]) + "\u3092\u8A18\u9332";
      if (ls.length) {
        const s = ls[0];
        const w = toNumber_(s["weight_kg"], null);
        txt = String(l["exercise_name_snapshot"]) + " " + (toBool_(s["is_bodyweight"]) ? "\u81EA\u91CD" : w !== null ? w + "kg" : "") + "\xD7" + (toNumber_(s["reps"], 0) || 0) + "\u3092\u8A18\u9332";
      } else if (toNumber_(l["duration_min"], 0)) {
        txt = String(l["exercise_name_snapshot"]) + " " + toNumber_(l["duration_min"], 0) + "\u5206\u3092\u8A18\u9332";
      }
      ready("D1", { text: txt });
      return;
    }
    const todayMeal = mLogs.filter(function(r) {
      return dateKeyOf_(new Date(r["timestamp"])) === t;
    });
    if (todayMeal.length) {
      ready("D1", { text: String(todayMeal[todayMeal.length - 1]["menu_name"] || "\u98DF\u4E8B") + "\u3092\u8A18\u9332" });
      return;
    }
    empty("D1");
  })();
  (function() {
    const thisWeek = gBucket_(todayKey_(), true);
    const days = {};
    tLogsAll.forEach(function(l) {
      const k = dateKeyOf_(new Date(l["training_date"]));
      if (gBucket_(k, true) === thisWeek) days[k] = true;
    });
    ready("D2", { days: Object.keys(days).length, reference_goal: 3 });
  })();
  (function() {
    const days = {};
    tLogsAll.forEach(function(l) {
      days[dateKeyOf_(new Date(l["training_date"]))] = true;
    });
    const ds = Object.keys(days).sort();
    if (ds.length < 6 || ds[ds.length - 1] === todayKey_()) {
      empty("R2");
      return;
    }
    let sum = 0;
    for (let i = ds.length - 5; i < ds.length; i++) {
      sum += ((/* @__PURE__ */ new Date(ds[i] + "T00:00:00")).getTime() - (/* @__PURE__ */ new Date(ds[i - 1] + "T00:00:00")).getTime()) / 864e5;
    }
    const avg = sum / 5;
    const current = ((/* @__PURE__ */ new Date(todayKey_() + "T00:00:00")).getTime() - (/* @__PURE__ */ new Date(ds[ds.length - 1] + "T00:00:00")).getTime()) / 864e5;
    if (current > avg * 1.5) ready("R2", { average_interval: Math.round(avg * 10) / 10, current_interval: current });
    else empty("R2");
  })();
  return blocks;
}
function growthAction(input, userId, action, params) {
  setGrowthDatasets(input);
  switch (action) {
    case "getGrowthSummary":
      return apiGetGrowthSummary(userId, params);
    case "getGrowthAll":
      return apiGetGrowthAll(userId, params);
    case "getTrainingAnalysis":
      return apiGetTrainingAnalysis(userId, params);
    case "getMenuTrajectory":
      return apiGetMenuTrajectory(userId, params);
    case "getMealAnalysis":
      return apiGetMealAnalysis(userId, params);
    case "getBodyAnalysis":
      return apiGetBodyAnalysis(userId, params);
    default:
      return { ok: false, error: { code: "MIGRATION_PENDING", message: "\u3053\u306EAPI action\u306FVercel\u79FB\u884C\u306E\u6E96\u5099\u4E2D\u3067\u3059" } };
  }
}

// src/server/readApi.ts
function text(row, key, fallback = "") {
  const value = row[key];
  return value === null || value === void 0 ? fallback : String(value);
}
function numberValue(value, fallback = null) {
  if (value === "" || value === null || value === void 0) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function bool(value) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}
function ok(data) {
  return { ok: true, data };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}
function notFound(message) {
  return fail("NOT_FOUND", message);
}
async function userRecord(context, userId) {
  const rows = await getRows(context, "users", (row2) => text(row2, "user_id") === userId);
  const row = rows[0];
  return {
    userId,
    name: row ? text(row, "User_Name") || text(row, "user_name") || "\u30E6\u30FC\u30B6\u30FC" : "\u30E6\u30FC\u30B6\u30FC",
    weight: numberValue(row?.weight),
    height: numberValue(row?.height),
    targetCalories: numberValue(row?.target_calories),
    isPremium: bool(row?.is_premium)
  };
}
function sortByDateDesc(a, b, field) {
  return asDate(b[field]).getTime() - asDate(a[field]).getTime();
}
async function trainingMaster(context) {
  return getRows(context, "Training_Master", (row) => bool(row.is_active));
}
async function trainingMenus(context, userId) {
  const rows = await getRows(context, "Training_Menus", (row) => text(row, "user_id") === userId && bool(row.is_active));
  return rows.sort((a, b) => (numberValue(a.display_order, 0) ?? 0) - (numberValue(b.display_order, 0) ?? 0));
}
async function trainingSetsByLog(context, logIds) {
  const rows = await getRows(context, "Training_Sets", logIds ? (row) => logIds.has(text(row, "training_log_id")) : void 0);
  const byLog = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    const key = text(row, "training_log_id");
    const list = byLog.get(key) ?? [];
    list.push(row);
    byLog.set(key, list);
  });
  byLog.forEach((list) => list.sort((a, b) => (numberValue(a.set_no, 0) ?? 0) - (numberValue(b.set_no, 0) ?? 0)));
  return byLog;
}
async function trainingLogs(context, userId) {
  const [logs, allSets] = await Promise.all([
    getRows(context, "Training_Logs", (row) => text(row, "user_id") === userId),
    getRows(context, "Training_Sets")
  ]);
  const ids = new Set(logs.map((row) => text(row, "training_log_id")));
  const setsByLog = /* @__PURE__ */ new Map();
  allSets.forEach((row) => {
    const key = text(row, "training_log_id");
    if (!ids.has(key)) return;
    const list = setsByLog.get(key) ?? [];
    list.push(row);
    setsByLog.set(key, list);
  });
  setsByLog.forEach((list) => list.sort((a, b) => (numberValue(a.set_no, 0) ?? 0) - (numberValue(b.set_no, 0) ?? 0)));
  logs.forEach((log) => {
    log.sets = setsByLog.get(text(log, "training_log_id")) ?? [];
  });
  return logs.sort((a, b) => sortByDateDesc(a, b, "training_date"));
}
async function getTrainingLogs(context, userId, params) {
  const user = await userRecord(context, userId);
  const all = await trainingLogs(context, userId);
  const defaultFrom = dateKeyOf(addDays(/* @__PURE__ */ new Date(), -6));
  const from = user.isPremium ? String(params.from || defaultFrom) : defaultFrom;
  const to = user.isPremium ? String(params.to || todayKey()) : todayKey();
  return ok({ logs: all.filter((log) => {
    const key = dateKeyOf(log.training_date);
    return key >= from && key <= to;
  }), from, to, range_restricted: !user.isPremium });
}
async function getTrainingLogDetail(context, userId, params) {
  const id = String(params.training_log_id ?? "");
  const log = await findById(context, "Training_Logs", "training_log_id", id);
  if (!log || text(log, "user_id") !== userId) return notFound("\u30ED\u30B0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
  const user = await userRecord(context, userId);
  if (!user.isPremium && dateKeyOf(log.training_date) < dateKeyOf(addDays(/* @__PURE__ */ new Date(), -6))) return notFound("\u30ED\u30B0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093");
  const sets = (await trainingSetsByLog(context, /* @__PURE__ */ new Set([id]))).get(id) ?? [];
  const allSets = await getRows(context, "Training_Sets");
  const countBy = /* @__PURE__ */ new Map();
  allSets.forEach((set) => countBy.set(text(set, "training_log_id"), (countBy.get(text(set, "training_log_id")) ?? 0) + 1));
  const masterId = text(log, "master_id");
  const name = text(log, "exercise_name_snapshot");
  const from = dateKeyOf(addDays(/* @__PURE__ */ new Date(), user.isPremium ? -89 : -6));
  const history = (await getRows(context, "Training_Logs", (row) => {
    if (text(row, "user_id") !== userId || text(row, "training_log_id") === id) return false;
    const matches = masterId ? text(row, "master_id") === masterId : text(row, "exercise_name_snapshot") === name;
    const key = dateKeyOf(row.training_date);
    return matches && key >= from && key <= todayKey();
  })).sort((a, b) => sortByDateDesc(a, b, "training_date")).slice(0, 20).map((row) => ({
    training_log_id: row.training_log_id,
    training_date: row.training_date,
    estimated_calories: row.estimated_calories,
    duration_min: row.duration_min,
    sets_count: countBy.get(text(row, "training_log_id")) ?? 0
  }));
  return ok({ log, sets, history, history_restricted: !user.isPremium });
}
async function getDailyCalorieSummary(context, userId, params) {
  const date = params.date ? dateKeyOf(params.date) : todayKey();
  const [meals, exercises, user] = await Promise.all([
    getRows(context, "logs", (row) => text(row, "user_id") === userId && dateKeyOf(row.timestamp) === date),
    getRows(context, "Training_Logs", (row) => text(row, "user_id") === userId && dateKeyOf(row.training_date) === date),
    userRecord(context, userId)
  ]);
  const target = user.targetCalories || 2e3;
  const intake = meals.reduce((sum, row) => sum + (numberValue(row.calories, 0) ?? 0), 0);
  const exercise = exercises.reduce((sum, row) => sum + (numberValue(row.estimated_calories, 0) ?? 0), 0);
  return ok({ date, target_calories: target, intake_calories: intake, remaining_calories: target - intake, estimated_exercise_calories: exercise, exercise_note: "\u30BB\u30C3\u30C8\u5185\u5BB9\u7B49\u304B\u3089\u63A8\u5B9A\u3057\u305F\u53C2\u8003\u5024\u3067\u3059" });
}
function weekStart(dateKey) {
  const date = /* @__PURE__ */ new Date(`${dateKey}T00:00:00+09:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return dateKeyOf(date);
}
function buildGlance(logs, setsByLog, meals) {
  const blocks = {};
  const today = todayKey();
  const todayLogs = logs.filter((log) => dateKeyOf(log.training_date) === today).sort((a, b) => text(b, "created_at").localeCompare(text(a, "created_at")));
  if (todayLogs.length) {
    const log = todayLogs[0];
    const sets = setsByLog.get(text(log, "training_log_id")) ?? [];
    let sentence = `${text(log, "exercise_name_snapshot")}\u3092\u8A18\u9332`;
    if (sets.length) {
      const set = sets[0];
      const weight = numberValue(set.weight_kg);
      sentence = `${text(log, "exercise_name_snapshot")} ${bool(set.is_bodyweight) ? "\u81EA\u91CD" : weight === null ? "" : `${weight}kg`}\xD7${numberValue(set.reps, 0) ?? 0}\u3092\u8A18\u9332`;
    } else if ((numberValue(log.duration_min, 0) ?? 0) > 0) {
      sentence = `${text(log, "exercise_name_snapshot")} ${numberValue(log.duration_min, 0)}\u5206\u3092\u8A18\u9332`;
    }
    blocks.D1 = { status: "ready", data: { text: sentence } };
  } else {
    const todayMeals = meals.filter((meal) => dateKeyOf(meal.timestamp) === today);
    blocks.D1 = todayMeals.length ? { status: "ready", data: { text: `${text(todayMeals[todayMeals.length - 1], "menu_name") || "\u98DF\u4E8B"}\u3092\u8A18\u9332` } } : { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  const currentWeek = weekStart(today);
  const days = new Set(logs.filter((log) => weekStart(dateKeyOf(log.training_date)) === currentWeek).map((log) => dateKeyOf(log.training_date)));
  blocks.D2 = { status: "ready", data: { days: days.size, reference_goal: 3 } };
  const allDays = [...new Set(logs.map((log) => dateKeyOf(log.training_date)))].sort();
  if (allDays.length < 6 || allDays[allDays.length - 1] === today) {
    blocks.R2 = { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  } else {
    let sum = 0;
    for (let index = allDays.length - 5; index < allDays.length; index += 1) {
      sum += ((/* @__PURE__ */ new Date(`${allDays[index]}T00:00:00+09:00`)).getTime() - (/* @__PURE__ */ new Date(`${allDays[index - 1]}T00:00:00+09:00`)).getTime()) / 864e5;
    }
    const average = sum / 5;
    const current = ((/* @__PURE__ */ new Date(`${today}T00:00:00+09:00`)).getTime() - (/* @__PURE__ */ new Date(`${allDays[allDays.length - 1]}T00:00:00+09:00`)).getTime()) / 864e5;
    blocks.R2 = current > average * 1.5 ? { status: "ready", data: { average_interval: Math.round(average * 10) / 10, current_interval: current } } : { status: "empty", message: "\u307E\u3060\u30C7\u30FC\u30BF\u304C\u8DB3\u308A\u307E\u305B\u3093" };
  }
  return blocks;
}
async function getDashboardAll(context, userId, params) {
  const [user, logs, meals] = await Promise.all([
    userRecord(context, userId),
    getRows(context, "Training_Logs", (row) => text(row, "user_id") === userId),
    getRows(context, "logs", (row) => text(row, "user_id") === userId)
  ]);
  const ids = new Set(logs.map((row) => text(row, "training_log_id")));
  const [setsByLog, summaryResult, goalResult] = await Promise.all([
    trainingSetsByLog(context, ids),
    getDailyCalorieSummary(context, userId, params),
    getGoalPlans(context, userId)
  ]);
  if (!summaryResult.ok) return summaryResult;
  const goalBanner = goalResult.ok ? buildGoalBanner(goalResult.data) : { show: false, message: "" };
  const glance = buildGlance(logs, setsByLog, meals);
  return ok({ summary: summaryResult.data, dashboard: { user: { name: user.name, isPremium: user.isPremium }, glance }, glance, goal_banner: goalBanner });
}
function buildGoalBanner(data) {
  const active = data?.active_plan;
  const end = text(active ?? {}, "planned_end_date").slice(0, 10);
  const show = !!end && todayKey() > end;
  return { show, message: show ? "\u76EE\u6A19\u671F\u9593\u304C\u7D42\u4E86\u3057\u3066\u3044\u307E\u3059\u3002\u73FE\u5728\u306E\u4F53\u91CD\u30FB\u4F53\u7D44\u6210\u3092\u78BA\u8A8D\u3057\u3001\u5FC5\u8981\u306B\u5FDC\u3058\u3066\u76EE\u6A19\u3092\u66F4\u65B0\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : "" };
}
function nutritionBounds(range) {
  const days = { "7d": 6, "30d": 29, "90d": 89, "1y": 364 };
  return { from: days[range] === void 0 ? null : dateKeyOf(addDays(/* @__PURE__ */ new Date(), -days[range])), to: todayKey() };
}
async function mealDays(context, userId, bounds) {
  const days = /* @__PURE__ */ new Map();
  const rows = await getRows(context, "logs", (row) => text(row, "user_id") === userId);
  rows.forEach((row) => {
    const key = dateKeyOf(row.timestamp);
    if (!inBounds(key, bounds)) return;
    const day = days.get(key) ?? {
      date: key,
      meals_count: 0,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      calcium: 0,
      iron: 0,
      potassium: 0,
      magnesium: 0,
      zinc: 0,
      vit_a: 0,
      vit_c: 0,
      vit_d: 0,
      vit_e: 0,
      vit_b1: 0,
      vit_b2: 0,
      vit_b6: 0,
      vit_b12: 0,
      folate: 0
    };
    day.meals_count += 1;
    ["calories", "protein", "fat", "carbs", "fiber", "calcium", "iron", "potassium", "magnesium", "zinc", "vit_a", "vit_c", "vit_d", "vit_e", "vit_b1", "vit_b2", "vit_b6", "vit_b12", "folate"].forEach((field) => {
      day[field] += numberValue(row[field], 0) ?? 0;
    });
    days.set(key, day);
  });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function inBounds(key, bounds) {
  return !!key && (!bounds.from || key >= bounds.from) && key <= bounds.to;
}
async function nutritionProfile(context, userId) {
  const row = await findById(context, "users", "user_id", userId);
  return row ? { gender: text(row, "gender"), age: numberValue(row.age), isPremium: bool(row.is_premium) } : null;
}
function pfcRange(age) {
  return { protein_pct: age !== null && age >= 50 && age <= 64 ? [14, 20] : [13, 20], fat_pct: [20, 30], carbs_pct: [50, 65] };
}
async function nutritionReferences(context, gender, age) {
  const band = age !== null && age >= 18 && age <= 29 ? [18, 29] : age !== null && age >= 50 && age <= 64 ? [50, 64] : [30, 49];
  const rows = await getRows(context, "Nutrition_Reference", (row) => bool(row.is_active) && text(row, "gender") === gender && numberValue(row.age_min) === band[0] && numberValue(row.age_max) === band[1]);
  const result = {};
  rows.forEach((row) => {
    const parts2 = text(row, "nutrient_id").split("_");
    const key = parts2.slice(0, Math.max(parts2.length - 3, 1)).join("_");
    result[key] = { value: numberValue(row.reference_value, 0) ?? 0, type: text(row, "reference_type"), unit: text(row, "unit"), name: text(row, "nutrient_name") };
  });
  return result;
}
async function getNutritionAnalysis(context, userId, params) {
  const user = await userRecord(context, userId);
  const range = String(params.range || "7d");
  if (!["7d", "30d", "90d", "1y", "all"].includes(range)) return fail("VALIDATION_ERROR", "range\u304C\u4E0D\u6B63\u3067\u3059");
  const effective = user.isPremium ? range : "7d";
  const bounds = nutritionBounds(effective);
  const days = await mealDays(context, userId, bounds);
  const recorded = days.length;
  const profile = await nutritionProfile(context, userId);
  const genderOk = !!profile && (profile.gender === "\u7537\u6027" || profile.gender === "\u5973\u6027");
  let n1;
  if (!recorded) n1 = { status: "empty" };
  else if (recorded < 3) n1 = { status: "insufficient" };
  else {
    const sums = days.reduce((sum, day) => ({ cal: sum.cal + day.calories, p: sum.p + day.protein, f: sum.f + day.fat, c: sum.c + day.carbs }), { cal: 0, p: 0, f: 0, c: 0 });
    const avgP = sums.p / recorded;
    const avgF = sums.f / recorded;
    const avgC = sums.c / recorded;
    const pk = avgP * 4;
    const fk = avgF * 9;
    const ck = avgC * 4;
    const total = pk + fk + ck;
    n1 = {
      status: "ok",
      avg_calories: Math.round(sums.cal / recorded),
      avg_protein_g: Math.round(avgP * 10) / 10,
      avg_fat_g: Math.round(avgF * 10) / 10,
      avg_carbs_g: Math.round(avgC * 10) / 10,
      ratio_protein_pct: total > 0 ? Math.round(pk / total * 1e3) / 10 : null,
      ratio_fat_pct: total > 0 ? Math.round(fk / total * 1e3) / 10 : null,
      ratio_carbs_pct: total > 0 ? Math.round(ck / total * 1e3) / 10 : null,
      reference_range: pfcRange(profile?.age ?? null)
    };
  }
  let n2;
  if (!recorded) n2 = { status: "empty", nutrients: [] };
  else if (recorded < 3 || !genderOk) n2 = { status: "insufficient", nutrients: [] };
  else {
    const refs = await nutritionReferences(context, profile.gender, profile.age);
    const keys = ["fiber", "calcium", "iron", "potassium", "magnesium", "zinc", "vit_a", "vit_c", "vit_d", "vit_e", "vit_b1", "vit_b2", "vit_b6", "vit_b12", "folate"];
    const nutrients = keys.map((key) => {
      const ref = refs[key];
      const avgRaw = days.reduce((sum, day) => sum + Number(day[key] ?? 0), 0) / recorded;
      const avg = key === "vit_a" ? avgRaw / 3.33 : avgRaw;
      const raw = ref && ref.value > 0 ? avg / ref.value * 100 : 0;
      return {
        key,
        name: ref?.name ?? key,
        avg_intake: Math.round(avg * 10) / 10,
        unit: ref?.unit ?? "",
        reference_value: ref?.value ?? null,
        reference_type: ref?.type ?? "",
        achievement_pct_raw: Math.round(raw * 10) / 10,
        achievement_pct_display: Math.round(Math.min(raw, 200) * 10) / 10
      };
    }).sort((a, b) => a.achievement_pct_raw - b.achievement_pct_raw);
    n2 = { status: "ok", nutrients };
  }
  const n3 = n2.status === "ok" ? n2.nutrients.slice(0, 3).filter((nutrient) => nutrient.achievement_pct_raw < 100).map((nutrient) => ({ nutrient_key: nutrient.key, nutrient_name: nutrient.name, message: `\u8A18\u9332\u4E0A\u3001${nutrient.name}\u306E\u6442\u53D6\u91CF\u304C\u5C11\u306A\u3081\u3067\u3059` })) : [];
  const n4 = !recorded ? { status: "empty" } : recorded < 3 ? { status: "insufficient" } : { status: "ok", avg_meals_per_day: Math.round(days.reduce((sum, day) => sum + day.meals_count, 0) / recorded * 10) / 10 };
  const menuAgg = /* @__PURE__ */ new Map();
  if (recorded) {
    const rows = await getRows(context, "logs", (row) => text(row, "user_id") === userId);
    rows.forEach((row) => {
      if (!inBounds(dateKeyOf(row.timestamp), bounds)) return;
      const name = text(row, "menu_name").trim();
      if (!name) return;
      const current = menuAgg.get(name) ?? { count: 0, cal: 0, protein: 0 };
      current.count += 1;
      current.cal += numberValue(row.calories, 0) ?? 0;
      current.protein += numberValue(row.protein, 0) ?? 0;
      menuAgg.set(name, current);
    });
  }
  const n5 = [...menuAgg.entries()].map(([menu_name, value]) => ({ menu_name, count: value.count, avg_calories: Math.round(value.cal / value.count), avg_protein_g: Math.round(value.protein / value.count * 10) / 10 })).sort((a, b) => b.count - a.count).slice(0, 5);
  return ok({
    range: effective,
    recorded_days: recorded,
    status: recorded === 0 ? "empty" : recorded < 3 ? "insufficient" : "ok",
    n1_pfc: n1,
    n2_micronutrients: n2,
    n3_hints: n3,
    n4_meal_frequency: n4,
    n5_top_menus: n5,
    plan_limits: { range_days: user.isPremium ? null : 7 },
    notes: {
      reference: "\u6804\u990A\u57FA\u6E96\u5024\u306F\u6210\u4EBA\u5411\u3051\u306E\u4E00\u822C\u7684\u306A\u76EE\u5B89\u3067\u3042\u308A\u3001\u533B\u5B66\u7684\u306A\u8A3A\u65AD\u30FB\u4FDD\u8A3C\u3092\u884C\u3046\u3082\u306E\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002\u5E74\u9F62\u3084\u4F53\u8CEA\u306B\u3088\u308B\u500B\u4EBA\u5DEE\u304C\u3042\u308A\u307E\u3059\u3002",
      no_record: "\u8A18\u9332\u304C\u306A\u3044\u65E5\u306F\u3001\u98DF\u3079\u3066\u3044\u306A\u3044\u3053\u3068\u3092\u610F\u5473\u3057\u307E\u305B\u3093\u3002",
      pfc: "PFC\u6BD4\u306F\u98DF\u4E8B\u8A18\u9332\u304B\u3089\u7B97\u51FA\u3057\u305F\u53C2\u8003\u5024\u3067\u3059\u3002",
      recorded_days: "\u5E73\u5747\u5024\u306F\u8A18\u9332\u304C\u3042\u308B\u65E5\u6570\u3092\u57FA\u6E96\u306B\u7B97\u51FA\u3057\u3066\u3044\u307E\u3059\u3002",
      protein_bcaa_note: "BCAA\uFF08\u30ED\u30A4\u30B7\u30F3\u30FB\u30A4\u30BD\u30ED\u30A4\u30B7\u30F3\u30FB\u30D0\u30EA\u30F3\uFF09\u306F\u30BF\u30F3\u30D1\u30AF\u8CEA\u306B\u542B\u307E\u308C\u308B\u30A2\u30DF\u30CE\u9178\u3067\u3059\u3002\u82E5\u5E74\u6210\u4EBA\u3067\u306F1\u56DE\u3042\u305F\u308A\u306E\u30ED\u30A4\u30B7\u30F3\u91CF\u3068\u7B4B\u30BF\u30F3\u30D1\u30AF\u5408\u6210\u306E\u76F8\u95A2\u306F\u660E\u78BA\u3067\u306A\u304F\u3001\u7DCF\u30BF\u30F3\u30D1\u30AF\u8CEA\u91CF\uFF08\u76EE\u5B89 \u7D042g/kg/\u65E5\uFF09\u304C\u571F\u53F0\u3067\u3059\u3002\u9AD8\u9F62\u306B\u306A\u308B\u307B\u3069\u30A2\u30DF\u30CE\u9178\u3078\u306E\u7B4B\u306E\u53CD\u5FDC\u304C\u920D\u304F\u306A\u308B\u305F\u3081\u30011\u56DE\u3042\u305F\u308A\u306E\u91CF\u306E\u91CD\u8981\u6027\u304C\u4E0A\u304C\u308A\u307E\u3059\u3002\u30B5\u30D7\u30EA\u30E1\u30F3\u30C8\u306F\u7DCF\u30A8\u30CD\u30EB\u30AE\u30FC\u3068\u30DE\u30AF\u30ED\u6804\u990A\u7D20\u304C\u6574\u3063\u305F\u5F8C\u306E\u88DC\u5B8C\u7684\u4F4D\u7F6E\u3065\u3051\u3067\u3059\u3002\u672C\u8868\u793A\u306F\u53C2\u8003\u60C5\u5831\u3067\u3042\u308A\u3001\u533B\u5B66\u7684\u30FB\u52B9\u679C\u306E\u4FDD\u8A3C\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"
    }
  });
}
async function getFoodHistory(context, userId, params) {
  const user = await userRecord(context, userId);
  const range = String(params.range || "7d");
  if (!["7d", "30d", "90d", "1y", "all"].includes(range)) return fail("VALIDATION_ERROR", "range\u304C\u4E0D\u6B63\u3067\u3059");
  const effective = user.isPremium ? range : "7d";
  const days = await mealDays(context, userId, nutritionBounds(effective));
  return ok({ range: effective, days: days.map((day) => ({ date: day.date, meals_count: day.meals_count, calories: day.calories, protein: Math.round(day.protein * 10) / 10 })) });
}
async function getFoodDay(context, userId, params) {
  const date = String(params.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("VALIDATION_ERROR", "date\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059");
  const user = await userRecord(context, userId);
  const bounds = nutritionBounds("7d");
  if (!user.isPremium && !inBounds(date, bounds)) return notFound("\u7121\u6599\u30D7\u30E9\u30F3\u306E\u671F\u9593\u5916\u3067\u3059");
  const rows = (await getRows(context, "logs", (row) => text(row, "user_id") === userId && dateKeyOf(row.timestamp) === date)).sort((a, b) => asDate(a.timestamp).getTime() - asDate(b.timestamp).getTime() || text(a, "log_id").localeCompare(text(b, "log_id")));
  return ok({ date, status: rows.length ? "ok" : "empty", meals: rows.map((row) => ({
    timestamp: formatFoodTimestamp(row.timestamp),
    menu_name: text(row, "menu_name"),
    calories: numberValue(row.calories, 0) ?? 0,
    protein: Math.round((numberValue(row.protein, 0) ?? 0) * 10) / 10,
    fat: Math.round((numberValue(row.fat, 0) ?? 0) * 10) / 10,
    carbs: Math.round((numberValue(row.carbs, 0) ?? 0) * 10) / 10,
    advice: text(row, "advice")
  })) });
}
async function getGoalPlans(context, userId) {
  const rows = await getRows(context, "Goal_Plans", (row) => text(row, "user_id") === userId);
  let active = null;
  const history = [];
  rows.forEach((row) => {
    if (text(row, "status").toLowerCase() === "active") {
      if (!active || text(row, "start_date") > text(active, "start_date")) {
        if (active) history.push(active);
        active = row;
      } else history.push(row);
    } else history.push(row);
  });
  history.sort((a, b) => text(b, "start_date").localeCompare(text(a, "start_date")));
  return ok({ active_plan: active, history, notes: { disclaimer: "\u76EE\u6A19\u9054\u6210\u5EA6\u304A\u3088\u3073\u8868\u793A\u306F\u73FE\u5728\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u308B\u76EE\u6A19\u30D7\u30E9\u30F3\u306B\u57FA\u3065\u304F\u53C2\u8003\u5024\u3067\u3059\u3002" } });
}
async function getTrainingBoard(context, userId) {
  const [user, menus, allLogs] = await Promise.all([
    userRecord(context, userId),
    trainingMenus(context, userId),
    getRows(context, "Training_Logs")
  ]);
  const from = dateKeyOf(addDays(/* @__PURE__ */ new Date(), user.isPremium ? -89 : -6));
  const logs = allLogs.filter((row) => text(row, "user_id") === userId && dateKeyOf(row.training_date) >= from);
  const setsByLog = await trainingSetsByLog(context);
  const logsByMenu = /* @__PURE__ */ new Map();
  logs.forEach((log) => {
    const key = text(log, "menu_id");
    if (!key) return;
    const list = logsByMenu.get(key) ?? [];
    list.push(log);
    logsByMenu.set(key, list);
  });
  const groups = /* @__PURE__ */ new Map();
  menus.forEach((menu) => {
    const group = text(menu, "training_group", "\u305D\u306E\u4ED6") || "\u305D\u306E\u4ED6";
    if (group === "\u305D\u306E\u4ED6") return;
    const byDate = /* @__PURE__ */ new Map();
    (logsByMenu.get(text(menu, "menu_id")) ?? []).sort((a, b) => sortByDateDesc(a, b, "training_date")).forEach((log) => {
      const key = dateKeyOf(log.training_date);
      const list = byDate.get(key) ?? [];
      list.push(log);
      byDate.set(key, list);
    });
    const dates = [...byDate.keys()].sort().reverse().slice(0, 2);
    const sessions = dates.map((date) => ({ date, entries: (byDate.get(date) ?? []).map((log) => ({
      training_log_id: log.training_log_id,
      time: text(log, "created_at").includes("T") ? text(log, "created_at").slice(text(log, "created_at").indexOf("T") + 1, text(log, "created_at").indexOf("T") + 6) : "",
      duration_min: log.duration_min,
      distance_km: log.distance_km,
      rpe: log.rpe,
      memo: log.memo,
      sets: (setsByLog.get(text(log, "training_log_id")) ?? []).map((set) => ({ weight_kg: set.weight_kg, reps: set.reps, rpe: set.rpe, is_bodyweight: set.is_bodyweight }))
    })) }));
    const item = { menu_id: menu.menu_id, menu_name: menu.menu_name, training_type: menu.training_type, last_date: dates[0] ?? null, sessions };
    groups.set(group, [...groups.get(group) ?? [], item]);
  });
  return ok({ groups: [...groups.entries()].map(([group, items]) => ({ group, last_date: items.reduce((last, item) => {
    const date = item.last_date ?? null;
    return date && (!last || date > last) ? date : last;
  }, null), items })) });
}
async function getBodyComposition(context, userId, params) {
  const [user, allRows] = await Promise.all([
    userRecord(context, userId),
    getRows(context, "Body_Composition", (row) => text(row, "user_id") === userId)
  ]);
  const all = allRows.sort((a, b) => {
    const diff = sortByDateDesc(a, b, "measured_at");
    return diff || sortByDateDesc(a, b, "created_at");
  });
  const from = user.isPremium ? params.from ? String(params.from) : null : dateKeyOf(addDays(/* @__PURE__ */ new Date(), -6));
  const to = params.to ? String(params.to) : null;
  const trend = all.filter((row) => {
    const key = dateKeyOf(row.measured_at);
    return (!from || key >= from) && (!to || key <= to);
  }).map((row) => ({ body_log_id: row.body_log_id, measured_at: row.measured_at, weight_kg: numberValue(row.weight_kg) }));
  const detailFields = ["body_fat_pct", "skeletal_muscle_kg", "muscle_mass_kg", "body_water_pct", "visceral_fat", "bmr", "waist_cm"];
  const details = all.filter((row) => detailFields.some((field) => numberValue(row[field]) !== null)).slice(0, 2).map((row) => ({
    measured_at: row.measured_at,
    measurement_device: row.measurement_device,
    body_fat_pct: numberValue(row.body_fat_pct),
    skeletal_muscle_kg: numberValue(row.skeletal_muscle_kg),
    muscle_mass_kg: numberValue(row.muscle_mass_kg),
    body_water_pct: numberValue(row.body_water_pct),
    visceral_fat: numberValue(row.visceral_fat),
    bmr: numberValue(row.bmr),
    waist_cm: numberValue(row.waist_cm)
  }));
  const latest = all.map((row) => numberValue(row.weight_kg)).find((value) => value !== null) ?? null;
  const bmi = latest !== null && user.height !== null && user.height > 0 ? Math.round(latest / (user.height / 100) ** 2 * 10) / 10 : null;
  return ok({ weight_trend: trend, detail_records: details, latest_weight_kg: latest, bmi, plan_limits: { weight_days: user.isPremium ? null : 7, detail_records: 2 } });
}
var GROWTH_SHEETS = ["users", "Training_Logs", "Training_Sets", "Body_Composition", "logs", "Training_Master", "Training_Menus", "Goal_Plans"];
async function growthDispatch(context, userId, action, params) {
  await batchSheetValues(context, GROWTH_SHEETS);
  const entries = await Promise.all(GROWTH_SHEETS.map(async (sheetName) => [sheetName, await getRows(context, sheetName)]));
  const datasets2 = Object.fromEntries(entries);
  return growthAction(datasets2, userId, action, params);
}
async function dispatchRead(context, userId, action, params) {
  switch (action) {
    case "getTrainingMaster":
      return ok({ exercises: await trainingMaster(context) });
    case "getTrainingMenus": {
      const [user, menus] = await Promise.all([userRecord(context, userId), trainingMenus(context, userId)]);
      return ok({ menus, limit: user.isPremium ? null : 5 });
    }
    case "getTrainingLogs":
      return getTrainingLogs(context, userId, params);
    case "getTrainingLogDetail":
      return getTrainingLogDetail(context, userId, params);
    case "getTrainingFormInit": {
      const [user, menus, exercises] = await Promise.all([
        userRecord(context, userId),
        trainingMenus(context, userId),
        trainingMaster(context)
      ]);
      return ok({ menus, limit: user.isPremium ? null : 5, exercises });
    }
    case "getTrainingBoard":
      return getTrainingBoard(context, userId);
    case "getDailyCalorieSummary":
      return getDailyCalorieSummary(context, userId, params);
    case "getDashboardAll":
      return getDashboardAll(context, userId, params);
    case "getBodyComposition":
      return getBodyComposition(context, userId, params);
    case "getGoalPlans":
      return getGoalPlans(context, userId);
    case "getNutritionAnalysis":
      return getNutritionAnalysis(context, userId, params);
    case "getFoodHistory":
      return getFoodHistory(context, userId, params);
    case "getFoodDay":
      return getFoodDay(context, userId, params);
    case "getGrowthSummary":
    case "getGrowthAll":
    case "getTrainingAnalysis":
    case "getMenuTrajectory":
    case "getMealAnalysis":
    case "getBodyAnalysis":
      return growthDispatch(context, userId, action, params);
    default:
      return fail("MIGRATION_PENDING", "\u3053\u306EAPI action\u306FVercel\u79FB\u884C\u306E\u6E96\u5099\u4E2D\u3067\u3059");
  }
}

// api/index.ts
function failure2(code, message) {
  return { ok: false, error: { code, message } };
}
async function requestBody(req) {
  if (typeof req.body === "string" || Buffer.isBuffer(req.body)) return JSON.parse(String(req.body));
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on?.("data", (chunk) => {
      raw += chunk.toString();
    });
    req.on?.("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}
async function handler(req, res) {
  const allowedOrigin = process.env.FRONTEND_ORIGIN;
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json(failure2("METHOD_NOT_ALLOWED", "POST\u306E\u307F\u5BFE\u5FDC\u3057\u3066\u3044\u307E\u3059"));
    return;
  }
  let request;
  try {
    request = await requestBody(req);
  } catch {
    res.status(400).json(failure2("VALIDATION_ERROR", "\u30EA\u30AF\u30A8\u30B9\u30C8\u5F62\u5F0F\u304C\u4E0D\u6B63\u3067\u3059"));
    return;
  }
  const action = String(request.action ?? "");
  const params = request.params && typeof request.params === "object" ? request.params : {};
  if (!request.token) {
    res.status(401).json(failure2("AUTH_FAILED", "Token is required"));
    return;
  }
  if (isMutationAction(action)) {
    try {
      const proxied = await proxyMutation(request);
      res.status(proxied.status).json(proxied.body);
    } catch {
      res.status(502).json(failure2("GAS_PROXY_ERROR", "GAS\u30D0\u30C3\u30AF\u30A8\u30F3\u30C9\u3078\u306E\u8EE2\u9001\u306B\u5931\u6557\u3057\u307E\u3057\u305F"));
    }
    return;
  }
  const userId = await checkAuth(request.token);
  if (!userId) {
    res.status(401).json(failure2("AUTH_FAILED", "Invalid token or LINE API error"));
    return;
  }
  try {
    if (action === "health") {
      res.status(200).json({ ok: true, data: { status: "ok", method: "POST", time: (/* @__PURE__ */ new Date()).toISOString() } });
      return;
    }
    const context = createRequestContext();
    const result = await dispatchRead(context, userId, action, params);
    res.status(result.ok ? 200 : result.error.code === "NOT_FOUND" ? 404 : 400).json(result);
  } catch {
    res.status(500).json(failure2("SERVER_ERROR", "\u30B5\u30FC\u30D0\u30FC\u51E6\u7406\u306B\u5931\u6557\u3057\u307E\u3057\u305F"));
  }
}
export {
  handler as default
};
