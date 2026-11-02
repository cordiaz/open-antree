import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;

// Format: scrypt$N$r$p$<salt base64>$<hash base64>, so parameters can be
// raised later without breaking existing hashes.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) {
    return false;
  }
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(
    password,
    Buffer.from(saltB64, 'base64'),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM },
  );
  return timingSafeEqual(actual, expected);
}

// Verified against when the email doesn't exist, so a login attempt takes
// the same time whether or not the account exists.
export const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';
