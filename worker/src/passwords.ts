import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

function derive(password: string, salt: Uint8Array, iterations: number, length: number, digest: string): Promise<Buffer> {
  return new Promise((resolve, reject) => pbkdf2(password, salt, iterations, length, digest, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, 100000, 32, 'sha512');
  return `pbkdf2-sha512$100000$${Buffer.from(salt).toString('base64')}$${Buffer.from(key).toString('base64')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  try {
    let salt: Buffer, expected: Buffer, rounds: number, digest: string;
    if (encoded.startsWith('pbkdf2-sha512$')) {
      const parts = encoded.split('$'); rounds = Number(parts[1]); digest = 'sha512';
      salt = Buffer.from(parts[2], 'base64'); expected = Buffer.from(parts[3], 'base64');
    } else {
      // ASP.NET Identity v3 hashes retain their original salt, PRF and iteration count.
      const data = Buffer.from(encoded, 'base64');
      if (data[0] !== 1 || data.length < 45) return false;
      digest = ['sha1', 'sha256', 'sha512'][data.readUInt32BE(1)];
      rounds = data.readUInt32BE(5); const saltLength = data.readUInt32BE(9);
      if (!digest || saltLength < 16 || saltLength > 64) return false;
      salt = data.subarray(13,13 + saltLength); expected = data.subarray(13 + saltLength);
    }
    if (!Number.isInteger(rounds) || rounds < 1000 || rounds > 1000000 || expected.length < 16 || expected.length > 64) return false;
    const actual = await derive(password, salt, rounds, expected.length, digest);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}
