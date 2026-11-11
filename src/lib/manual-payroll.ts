/** Basic pay from manually entered days; does not read attendance. */
export function manualDailyPay(rate: string, days: string): number {
  const dailyRate = Number(rate), workedDays = Number(days);
  if (!rate.trim() || !days.trim() || !Number.isFinite(dailyRate) || !Number.isFinite(workedDays) || dailyRate < 0 || workedDays <= 0) return NaN;
  return Math.round((dailyRate * workedDays + Number.EPSILON) * 100) / 100;
}
