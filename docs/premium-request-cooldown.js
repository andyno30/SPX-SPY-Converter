// A browser courtesy, not an authorization boundary: the backend owns quotas.
// Share only cooldown metadata across same-origin tabs, scoped to the current
// session's user and resource. Never persist tokens or premium response data.
const MAX_RETRY_SECONDS = 3600;
const PREFIX = 'spyconverter:premium-cooldown:v1:';

export function retryAfterSeconds(value, now, fallback = 60) {
  let seconds;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    seconds = Math.min(MAX_RETRY_SECONDS, Number(value.trim()));
  } else if (typeof value === 'string' && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i.test(value)) {
    seconds = Math.ceil((Date.parse(value) - now) / 1000);
  }
  if (!Number.isFinite(seconds)) seconds = Number.isFinite(fallback) ? fallback : 60;
  return Math.max(1, Math.min(MAX_RETRY_SECONDS, Math.ceil(seconds)));
}

export function createPremiumRequestCooldown({
  now = () => Date.now(),
  storage = () => globalThis.localStorage,
  locks = () => globalThis.navigator?.locks,
} = {}) {
  const memory = new Map();
  let sharedStorageFailed = false;
  const generation = () => globalThis.crypto?.randomUUID?.() || `${now()}:${Math.random()}:${Math.random()}`;
  function keyFor(userId, resource) {
    // Missing identity must never share a cooldown with another signed-in user.
    if (typeof userId !== 'string' || !userId || userId.length > 128) return null;
    if (resource !== 'pro_prices' && resource !== 'options') return null;
    return PREFIX + resource + ':' + encodeURIComponent(userId);
  }
  function valid(record) {
    return record && typeof record.generation === 'string' && Number.isFinite(record.until) && record.until > now() &&
      record.until <= now() + MAX_RETRY_SECONDS * 1000 &&
      ((record.status === 429 && record.code === 'RATE_LIMITED') ||
       (record.status === 503 && record.code === 'QUOTA_UNAVAILABLE'));
  }
  function read(key) {
    if (!key) return null;
    let record;
    try {
      const shared = storage();
      if (!shared) throw new Error('Storage unavailable');
      record = sharedStorageFailed ? memory.get(key) : JSON.parse(shared.getItem(key) || 'null');
    } catch { sharedStorageFailed = true; record = memory.get(key); }
    if (!valid(record)) record = null;
    if (record) memory.set(key, record);
    else memory.delete(key);
    return record || null;
  }
  function errorFor(record, probeWait = 0) {
    const seconds = Math.max(1, Math.ceil((record.until - now()) / 1000));
    const wait = seconds < 60 ? `${seconds} second${seconds === 1 ? '' : 's'}` : `${Math.ceil(seconds / 60)} minute${seconds <= 60 ? '' : 's'}`;
    let message = record.code === 'RATE_LIMITED'
      ? `Premium request limit reached. Try again in ${wait}.`
      : `Premium updates are temporarily unavailable. Try again in ${wait}.`;
    if (probeWait) message += ` Retry now is available in ${probeWait} seconds.`;
    return Object.assign(new Error(message), {
      status: record.status, code: record.code, retryAt: record.until,
      retryAfterSeconds: seconds, isCooldown: true,
      canRetry: Boolean(locks()?.request) && !sharedStorageFailed,
    });
  }
  const locked = (key, callback) => locks()?.request
    ? locks().request(key + ':lock', { mode: 'exclusive' }, callback) : Promise.resolve().then(callback);
  return {
    check(userId, resource) {
      const record = read(keyFor(userId, resource));
      if (record) throw errorFor(record);
    },
    async begin(userId, resource, { manualProbe = false } = {}) {
      const key = keyFor(userId, resource);
      const record = read(key);
      if (!record) return null;
      if (!manualProbe || !locks()?.request || sharedStorageFailed) throw errorFor(record);
      return locked(key, () => {
        const current = read(key);
        if (!current) return null;
        let shared, lease;
        try {
          shared = storage();
          lease = JSON.parse(shared.getItem(key + ':probe') || 'null');
        } catch { sharedStorageFailed = true; throw errorFor(current); }
        if (Number.isFinite(lease?.until) && lease.until > now() && lease.until <= now() + 15000) {
          throw errorFor(current, Math.ceil((lease.until - now()) / 1000));
        }
        const claim = { until: now() + 15000, generation: generation() };
        try {
          shared.setItem(key + ':probe', JSON.stringify(claim));
          if (JSON.parse(shared.getItem(key + ':probe'))?.generation !== claim.generation) throw new Error('Lease unavailable');
        } catch { sharedStorageFailed = true; throw errorFor(current); }
        return { key, generation: current.generation };
      });
    },
    async completeProbe(probe) {
      if (!probe) return;
      await locked(probe.key, () => {
        // A newer 429/503 must survive an older successful in-flight probe.
        if (read(probe.key)?.generation !== probe.generation) return;
        try { storage().removeItem(probe.key); } catch { sharedStorageFailed = true; }
        memory.delete(probe.key);
      });
    },
    async responseError(userId, resource, response, body) {
      const limited = response.status === 429;
      const unavailable = response.status === 503 && body?.code === 'QUOTA_UNAVAILABLE';
      if (!limited && !unavailable) return null;
      const fallback = Number.isFinite(body?.retryAfterSeconds)
        ? body.retryAfterSeconds : unavailable ? 5 : 60;
      const seconds = retryAfterSeconds(response.headers?.get('Retry-After'), now(), fallback);
      const key = keyFor(userId, resource);
      return locked(key || PREFIX + 'anonymous', () => {
        const existing = read(key);
        const record = { status: response.status, code: limited ? 'RATE_LIMITED' : 'QUOTA_UNAVAILABLE',
          until: Math.max(now() + seconds * 1000, existing?.until || 0), generation: generation() };
        if (key) {
          memory.set(key, record);
          try { storage().setItem(key, JSON.stringify(record)); } catch { sharedStorageFailed = true; }
        }
        return errorFor(record);
      });
    },
  };
}

export const premiumRequestCooldown = createPremiumRequestCooldown();

// An explicit, bounded probe can discover recovery after an emergency backend
// disable; automatic polling continues to honor the original Retry-After.
export function bindCooldownRetry(status, retry) {
  const button = status.ownerDocument.createElement('button');
  button.type = 'button'; button.textContent = 'Retry now'; button.hidden = true;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await retry(); } finally { button.disabled = false; }
  });
  status.insertAdjacentElement('afterend', button);
  return { show: error => { button.hidden = !error?.isCooldown || !error?.canRetry; } };
}
