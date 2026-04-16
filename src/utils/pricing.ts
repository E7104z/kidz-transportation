// Pricing utility for KIDZ Transportation

const DAILY_BASE = 20.0;
const SURCHARGE_PER_MILE_9_12 = 3.0;
const RATE_13_PLUS = 2.25;
const ADDON_ONEWAY = 10.0;
const ADDON_ROUNDTRIP = 20.0;
const DRIVER_SPLIT = 0.75;

export function computeWeeklyCharge(
  mileage: number,
  daysPerWeek: number,
  isRoundTrip: boolean,
  numChildren: number
): { weekly: number; daily: number; driver: number; admin: number } {
  if (mileage <= 0 || daysPerWeek <= 0)
    return { weekly: 0, daily: 0, driver: 0, admin: 0 };

  let dailyOneWay: number;
  if (mileage <= 8) {
    dailyOneWay = DAILY_BASE;
  } else if (mileage <= 12) {
    dailyOneWay = DAILY_BASE + (mileage - 8) * SURCHARGE_PER_MILE_9_12;
  } else {
    dailyOneWay = mileage * RATE_13_PLUS;
  }

  const billableDays = daysPerWeek >= 3 ? 5 : daysPerWeek;
  let weeklyRide = dailyOneWay * billableDays;
  if (isRoundTrip) weeklyRide *= 2;

  const extraRiders = Math.max(0, numChildren - 1);
  const addon = isRoundTrip ? ADDON_ROUNDTRIP : ADDON_ONEWAY;
  const weekly = Math.round((weeklyRide + extraRiders * addon) * 100) / 100;
  const daily = Math.round((weekly / billableDays) * 100) / 100;
  const driver = Math.round(weekly * DRIVER_SPLIT * 100) / 100;
  const adminCut = Math.round(weekly * (1 - DRIVER_SPLIT) * 100) / 100;

  return { weekly, daily, driver, admin: adminCut };
}
