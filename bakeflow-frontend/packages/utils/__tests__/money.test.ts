/// <reference types="jest" />
import type { Money } from '@bakeflow/types';

import { formatNairaShort } from '../money';

const m = (v: string): Money => v as Money;

describe('formatNairaShort (the prototype moneyShort)', () => {
  it('keeps whole naira under a thousand', () => {
    expect(formatNairaShort(m('850.0000'))).toBe('₦850');
    expect(formatNairaShort(m('0.0000'))).toBe('₦0');
    expect(formatNairaShort(m('999.4999'))).toBe('₦999');
  });

  it('rounds thousands to a whole k', () => {
    expect(formatNairaShort(m('74500.0000'))).toBe('₦75k');
    expect(formatNairaShort(m('38300.0000'))).toBe('₦38k');
    expect(formatNairaShort(m('1000.0000'))).toBe('₦1k');
  });

  it('shows millions to two decimals, dropping .00', () => {
    expect(formatNairaShort(m('4820000.0000'))).toBe('₦4.82M');
    expect(formatNairaShort(m('1500000.0000'))).toBe('₦1.50M');
    expect(formatNairaShort(m('2000000.0000'))).toBe('₦2M');
  });

  it('never goes through a float', () => {
    expect(formatNairaShort(m('12345678901234.5678'))).toBe('₦12345678.90M');
  });

  it('signs negatives but not zero', () => {
    expect(formatNairaShort(m('-3000.0000'))).toBe('−₦3k');
    expect(formatNairaShort(m('-0.0000'))).toBe('₦0');
  });
});
