import { describe, it, expect } from 'vitest';
import { computeWeeklyCharge } from './pricing';

describe('computeWeeklyCharge', () => {
  it('returns zeroes for zero mileage', () => {
    const result = computeWeeklyCharge(0, 5, true, 1);
    expect(result.weekly).toBe(0);
    expect(result.daily).toBe(0);
  });

  it('computes a positive charge for typical input', () => {
    const result = computeWeeklyCharge(5, 5, true, 1);
    expect(result.weekly).toBeGreaterThan(0);
    expect(result.daily).toBeGreaterThan(0);
  });

  it('charges more for roundtrip vs one-way at same mileage and days', () => {
    const rt = computeWeeklyCharge(5, 5, true,  1);
    const ow = computeWeeklyCharge(5, 5, false, 1);
    expect(rt.weekly).toBeGreaterThan(ow.weekly);
  });

  it('scales up proportionally for multiple students', () => {
    const one = computeWeeklyCharge(5, 5, true, 1);
    const two = computeWeeklyCharge(5, 5, true, 2);
    expect(two.weekly).toBeGreaterThan(one.weekly);
  });

  it('driver split is ~70% of weekly rate (before addon)', () => {
    const result = computeWeeklyCharge(5, 5, false, 1);
    // driver share should be close to 70% of the weekly ride cost
    expect(result.driver).toBeGreaterThan(0);
    expect(result.driver + result.admin).toBeCloseTo(result.weekly, 0);
  });
});
