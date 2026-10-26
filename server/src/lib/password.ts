import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

function deriveKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt);
  // Version names the fixed parameters, allowing a future upgrade.
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$');
  const [version, salt, keyHex] = parts;
  if (parts.length !== 3 || version !== 'scrypt-v1' ||
      !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(keyHex ?? '')) {
    return false;
  }
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
}
