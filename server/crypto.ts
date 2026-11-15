import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_KEY_PATH = path.join(DATA_DIR, '.vault_key');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getMasterSecret(): Buffer {
  ensureDataDir();
  if (process.env.STUDIO_VAULT_SECRET) {
    return crypto.createHash('sha256').update(process.env.STUDIO_VAULT_SECRET).digest();
  }
  if (fs.existsSync(VAULT_KEY_PATH)) {
    const raw = fs.readFileSync(VAULT_KEY_PATH, 'utf8').trim();
    return Buffer.from(raw, 'hex');
  }
  const generated = crypto.randomBytes(32);
  fs.writeFileSync(VAULT_KEY_PATH, generated.toString('hex'), { mode: 0o600 });
  return generated;
}

export function encryptSecret(plaintext: string): string {
  const key = getMasterSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload || !payload.includes(':')) return '';
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return '';
  const key = getMasterSecret();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encrypted = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskApiKey(key: string): string {
  const trimmed = (key || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}••••••••${trimmed.slice(-4)}`;
}

export function signSessionToken(payload: { userId: string; role: string; exp: number }): string {
  const key = getMasterSecret();
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined
): { userId: string; role: string; exp: number } | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const key = getMasterSecret();
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      userId: string;
      role: string;
      exp: number;
    };
    if (!parsed.userId || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unknown error');
  // Strip any accidental key-like substrings (AIza..., gsk_...)
  return raw
    .replace(/AIza[0-9A-Za-z\-_]{15,}/g, 'AIza[REDACTED]')
    .replace(/gsk_[0-9A-Za-z]{15,}/g, 'gsk_[REDACTED]')
    .slice(0, 500);
}
