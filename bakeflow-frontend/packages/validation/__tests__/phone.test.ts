/// <reference types="jest" />
import { formatPhone, toE164Phone } from '../phone';

describe('toE164Phone', () => {
  it('reads Nigerian local numbers', () => {
    expect(toE164Phone('0803 123 4567')).toBe('+2348031234567');
    expect(toE164Phone('08031234567')).toBe('+2348031234567');
    expect(toE164Phone('0803-123-4567')).toBe('+2348031234567');
  });

  it('keeps international numbers and strips separators', () => {
    expect(toE164Phone('+234 803 123 4567')).toBe('+2348031234567');
    expect(toE164Phone('+44 20 7946 0958')).toBe('+442079460958');
    expect(toE164Phone('00234 803 123 4567')).toBe('+2348031234567');
    expect(toE164Phone('2348031234567')).toBe('+2348031234567');
  });

  it('refuses what it cannot read unambiguously', () => {
    expect(toE164Phone('')).toBeNull();
    expect(toE164Phone('0803 123')).toBeNull();
    expect(toE164Phone('8031234567')).toBeNull();
    expect(toE164Phone('name@example.com')).toBeNull();
    expect(toE164Phone('+0123456789')).toBeNull();
    expect(toE164Phone('+1234')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('groups Nigerian numbers', () => {
    expect(formatPhone('+2348031234567')).toBe('+234 803 123 4567');
  });
  it('leaves other numbers as they are', () => {
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
