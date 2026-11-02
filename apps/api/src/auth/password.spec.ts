import { DUMMY_HASH, hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    await expect(verifyPassword('s3cret-pass', hash)).resolves.toBe(true);
    await expect(verifyPassword('s3cret-Pass', hash)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects the dummy hash and malformed hashes without throwing', async () => {
    await expect(verifyPassword('anything', DUMMY_HASH)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plain-text')).resolves.toBe(false);
  });
});
