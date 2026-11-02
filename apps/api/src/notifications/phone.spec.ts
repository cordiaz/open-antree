import { maskPhone, normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['081234567890', '6281234567890'],
    ['0812-3456-7890', '6281234567890'],
    ['0812 3456 7890', '6281234567890'],
    ['(0812) 3456.7890', '6281234567890'],
    ['+6281234567890', '6281234567890'],
    ['+62 812-3456-7890', '6281234567890'],
    ['6281234567890', '6281234567890'],
    ['+14155550123', '14155550123'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('uses the given country code for local numbers', () => {
    expect(normalizePhone('0123456789', '60')).toBe('60123456789');
  });

  it.each(['', '0812abc', '12345', '+0812345678', '+1234567890123456', '08-'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('maskPhone', () => {
  it('shows only the last four digits', () => {
    expect(maskPhone('6281234567890')).toBe('••••7890');
  });
});
