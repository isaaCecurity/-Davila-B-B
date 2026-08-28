/// <reference types="jest" />
import {
  compareDecimalStrings,
  isNegativeDecimalString,
  isZeroDecimalString,
} from '../scalars';

describe('isZeroDecimalString', () => {
  it.each(['0', '0.0000', '-0.00', '+0', '000.000'])('treats %s as zero', (value) => {
    expect(isZeroDecimalString(value)).toBe(true);
  });

  it.each(['1', '0.0001', '-0.01', '100'])('treats %s as non-zero', (value) => {
    expect(isZeroDecimalString(value)).toBe(false);
  });
});

describe('isNegativeDecimalString', () => {
  it.each(['-1', '-0.0001', '-100.5000'])('treats %s as negative', (value) => {
    expect(isNegativeDecimalString(value)).toBe(true);
  });

  it.each(['0', '-0', '-0.00', '1', '100.0000'])(
    'does not treat %s as negative (zero has no sign)',
    (value) => {
      expect(isNegativeDecimalString(value)).toBe(false);
    },
  );
});

describe('compareDecimalStrings', () => {
  it('treats trailing/leading zero variants as equal', () => {
    expect(compareDecimalStrings('2.5', '2.50')).toBe(0);
    expect(compareDecimalStrings('02.5000', '2.5')).toBe(0);
    expect(compareDecimalStrings('-0.00', '0')).toBe(0);
  });

  it('orders by magnitude for positives', () => {
    expect(compareDecimalStrings('9', '10')).toBe(-1);
    expect(compareDecimalStrings('10', '9')).toBe(1);
    expect(compareDecimalStrings('100.0001', '100.0000')).toBe(1);
  });

  it('orders negatives below positives and zero', () => {
    expect(compareDecimalStrings('-1', '0')).toBe(-1);
    expect(compareDecimalStrings('-1', '1')).toBe(-1);
    expect(compareDecimalStrings('0', '-1')).toBe(1);
  });

  it('orders among negatives by magnitude, reversed', () => {
    // -100 is smaller (further from zero) than -1.
    expect(compareDecimalStrings('-100', '-1')).toBe(-1);
    expect(compareDecimalStrings('-1', '-100')).toBe(1);
    expect(compareDecimalStrings('-1.5', '-1.5000')).toBe(0);
  });

  it('never loses precision beyond double range, unlike Number()', () => {
    // The exact scenario scalars.ts's own header warns about: a value whose scale
    // Number() would silently truncate. If this routed through a float comparison these
    // two would incorrectly compare equal.
    expect(compareDecimalStrings('12345678901234.5678', '12345678901234.5679')).toBe(-1);
  });
});
