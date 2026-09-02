// auth.gs — LINEトークン検証 + キャッシュ
function checkAuth(token) {
  if (!token) return null;
  const cache = CacheService.getUserCache();
  const key = 'authcache_' + hashToken_(token);
  const cached = cache.get(key);
  if (cached) return cached;

  const userId = verifyLineToken(token);
  if (userId) {
    try { cache.put(key, userId, 300); } catch (err) {}
  }
  return userId;
}

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

function hashToken_(token) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  return raw.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}