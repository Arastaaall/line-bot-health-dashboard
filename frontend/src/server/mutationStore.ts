export type MutationStore = {
  get(key: string): Promise<string | null>;
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  deleteIfValue(key: string, value: string): Promise<boolean>;
};

function storeConfig(): { url: string; token: string } {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Missing server configuration: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  return { url: url.replace(/\/$/, ''), token };
}

async function command<T>(name: string, args: string[]): Promise<T> {
  const config = storeConfig();
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([name, ...args]),
  });
  if (!response.ok) throw new Error(`Mutation store ${name} failed`);
  const json = await response.json() as { result?: T };
  return json.result as T;
}

export class UpstashMutationStore implements MutationStore {
  get(key: string): Promise<string | null> {
    return command<string | null>('GET', [key]);
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await command<string | null>('SET', [key, value, 'NX', 'EX', String(ttlSeconds)]);
    return result === 'OK';
  }

  async deleteIfValue(key: string, value: string): Promise<boolean> {
    const script = 'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end';
    const result = await command<number>('EVAL', [script, '1', key, value]);
    return result === 1;
  }
}

// Used by contract tests only. Production requests always use the shared
// Upstash-backed implementation above; an in-memory fallback would not be
// safe for concurrent Vercel instances.
export class MemoryMutationStore implements MutationStore {
  private readonly values = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.get(key)) return false;
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async deleteIfValue(key: string, value: string): Promise<boolean> {
    if ((await this.get(key)) !== value) return false;
    this.values.delete(key);
    return true;
  }
}

export function createMutationStore(): MutationStore {
  return new UpstashMutationStore();
}
