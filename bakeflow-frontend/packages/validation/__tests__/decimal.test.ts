/// <reference types="jest" />
import {
  nonNegativeMoneySchema,
  nonNegativeQuantitySchema,
  nonZeroQuantitySchema,
  positiveMoneySchema,
  positiveQuantitySchema,
  signedMoneySchema,
  signedQuantitySchema,
  timestamptzSchema,
  uuidSchema,
} from '../decimal';

describe('nonNegativeMoneySchema', () => {
  it('accepts zero and positive exact decimal strings', () => {
    expect(nonNegativeMoneySchema.parse('0.0000')).toBe('0.0000');
    expect(nonNegativeMoneySchema.parse('184500.0000')).toBe('184500.0000');
  });

  it('rejects a negative value', () => {
    expect(nonNegativeMoneySchema.safeParse('-1.0000').success).toBe(false);
  });

  it('rejects a JSON number with an actionable message rather than coercing it', () => {
    // This is the precision tripwire scalars.ts's header describes: a missing ::text
    // cast turns "184500.0000" into the JSON number 184500, which must fail loudly here
    // rather than silently being accepted as a valid (but already-corrupted) value.
    const result = nonNegativeMoneySchema.safeParse(184500 as unknown as string);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/exact decimal string/);
    }
  });

  it('rejects more than 4 decimal places', () => {
    expect(nonNegativeMoneySchema.safeParse('1.00001').success).toBe(false);
  });

  it('rejects more than 15 integer digits', () => {
    expect(nonNegativeMoneySchema.safeParse('1234567890123456').success).toBe(false);
  });
});

describe('positiveMoneySchema', () => {
  it('rejects zero, unlike nonNegativeMoneySchema', () => {
    expect(positiveMoneySchema.safeParse('0').success).toBe(false);
    expect(positiveMoneySchema.safeParse('0.0000').success).toBe(false);
    expect(positiveMoneySchema.safeParse('-0.00').success).toBe(false);
  });

  it('accepts a positive value', () => {
    expect(positiveMoneySchema.parse('0.0001')).toBe('0.0001');
  });

  it('rejects a negative value', () => {
    expect(positiveMoneySchema.safeParse('-5.0000').success).toBe(false);
  });
});

describe('signedMoneySchema', () => {
  it('accepts negative, zero, and positive values with no sign constraint', () => {
    expect(signedMoneySchema.parse('-500.0000')).toBe('-500.0000');
    expect(signedMoneySchema.parse('0.0000')).toBe('0.0000');
    expect(signedMoneySchema.parse('500.0000')).toBe('500.0000');
  });
});

describe('nonNegativeQuantitySchema / positiveQuantitySchema / signedQuantitySchema', () => {
  it('quantity patterns cap at 14 integer digits, one fewer than money', () => {
    expect(nonNegativeQuantitySchema.safeParse('12345678901234').success).toBe(true);
    expect(nonNegativeQuantitySchema.safeParse('123456789012345').success).toBe(false);
  });

  it('positiveQuantitySchema rejects zero and negatives', () => {
    expect(positiveQuantitySchema.safeParse('0').success).toBe(false);
    expect(positiveQuantitySchema.safeParse('-1').success).toBe(false);
    expect(positiveQuantitySchema.parse('1.0000')).toBe('1.0000');
  });

  it('signedQuantitySchema allows a genuinely negative stock level', () => {
    // stock_movements/*_stock_levels have no non-negative CHECK on quantity_on_hand,
    // per this schema's own documented policy (an opted-in tenant may go negative).
    expect(signedQuantitySchema.parse('-42.5000')).toBe('-42.5000');
  });
});

describe('nonZeroQuantitySchema', () => {
  it('rejects exactly zero but allows either sign otherwise', () => {
    expect(nonZeroQuantitySchema.safeParse('0').success).toBe(false);
    expect(nonZeroQuantitySchema.safeParse('0.0000').success).toBe(false);
    expect(nonZeroQuantitySchema.parse('-1.0000')).toBe('-1.0000');
    expect(nonZeroQuantitySchema.parse('1.0000')).toBe('1.0000');
  });
});

describe('uuidSchema', () => {
  it('accepts a well-formed uuid', () => {
    expect(uuidSchema.safeParse('d1000000-0000-4000-8000-000000000001').success).toBe(true);
  });

  it('rejects a non-uuid string', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('timestamptzSchema', () => {
  it('accepts an ISO datetime with a timezone offset', () => {
    expect(timestamptzSchema.safeParse('2026-08-11T09:15:00+00:00').success).toBe(true);
  });

  it('rejects a bare date with no time/offset', () => {
    expect(timestamptzSchema.safeParse('2026-08-11').success).toBe(false);
  });
});
