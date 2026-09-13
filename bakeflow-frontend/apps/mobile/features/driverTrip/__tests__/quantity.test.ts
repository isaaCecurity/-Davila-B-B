/// <reference types="jest" />
import { fromUnits, isPositiveQuantity, stepQuantity, sumQuantities, toUnits } from '../quantity';

describe('toUnits / fromUnits', () => {
  it.each([
    ['0', '0'],
    ['12', '12'],
    ['12.5000', '12.5'],
    ['0.0001', '0.0001'],
    ['-3.25', '-3.25'],
    ['99999999999999.9999', '99999999999999.9999'],
  ])('round-trips %s as %s', (input, output) => {
    expect(fromUnits(toUnits(input))).toBe(output);
  });

  it.each(['', 'abc', '1.23456', '1e3', '--1'])('rejects %s', (input) => {
    expect(() => toUnits(input)).toThrow();
  });
});

describe('sumQuantities', () => {
  it('adds exactly where floats would drift', () => {
    expect(sumQuantities(['0.1', '0.2'])).toBe('0.3');
    expect(sumQuantities(['40', '-3', '-2.5', '-34.5'])).toBe('0');
    expect(sumQuantities([])).toBe('0');
  });
});

describe('stepQuantity', () => {
  it('steps whole units and floors at zero', () => {
    expect(stepQuantity('4', 1)).toBe('5');
    expect(stepQuantity('0.5', -1)).toBe('0');
    expect(stepQuantity('', 10)).toBe('10');
  });
});

describe('isPositiveQuantity', () => {
  it.each([['1', true], ['0.0001', true], ['0', false], ['-1', false], ['x', false]])('%s → %s', (v, ok) => {
    expect(isPositiveQuantity(v)).toBe(ok);
  });
});
