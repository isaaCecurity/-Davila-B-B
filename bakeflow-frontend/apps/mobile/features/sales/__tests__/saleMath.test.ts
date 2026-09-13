/// <reference types="jest" />
import { lineTotal, saleTotal } from '../saleMath';

describe('lineTotal', () => {
  it('multiplies exactly at scale 4', () => {
    expect(lineTotal('850.0000', 2)).toBe('1700');
    expect(lineTotal('1500.5000', 3)).toBe('4501.5');
    expect(lineTotal('0.1000', 3)).toBe('0.3');
  });
  it('treats non-positive or fractional counts safely', () => {
    expect(lineTotal('850', 0)).toBe('0');
    expect(lineTotal('850', 2.9)).toBe('1700');
  });
});

describe('saleTotal', () => {
  it('sums lines where floats would drift', () => {
    expect(saleTotal([{ unitPrice: '0.1000', count: 1 }, { unitPrice: '0.2000', count: 1 }])).toBe('0.3');
    expect(saleTotal([{ unitPrice: '1500.5000', count: 2 }, { unitPrice: '850.0000', count: 1 }])).toBe('3851');
    expect(saleTotal([])).toBe('0');
  });
});
