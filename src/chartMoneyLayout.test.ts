import { expect, it } from "vitest";
import { formatAccountMoney } from "./format";
import { chartMoneyLayout } from "./chartMoneyLayout";

it.each(["zh", "en"])("reserves room for the complete CNY16,000 axis label in %s", lang => {
  const layout = chartMoneyLayout([0, 1_600_000], value => formatAccountMoney(value, "CNY", lang));
  // Browser regression: the existing 70px axis clipped 28.77px of this label.
  expect(layout.axisWidth).toBeGreaterThan(99);
  expect(layout.minChartWidth - layout.axisWidth).toBeGreaterThanOrEqual(200);
});

it.each(["zh", "en"])("keeps negative USD and JPY labels complete at large magnitudes in %s", lang => {
  for (const currency of ["USD", "JPY"]) {
    const format = (value: number) => formatAccountMoney(value, currency, lang);
    const small = chartMoneyLayout([-100], format);
    const large = chartMoneyLayout([-9_876_543_210_123, 0, null], format);
    expect(large.axisWidth).toBeGreaterThan(small.axisWidth);
    expect(large.axisWidth).toBeGreaterThan(format(-9_876_543_210_123).length * 7);
    expect(large.minChartWidth).toBeGreaterThan(320);
    if (currency === "JPY") expect(format(-9_876_543_210_123)).not.toMatch(/\.\d/);
    expect(format(-9_876_543_210_123)).toContain("-");
  }
});

it("handles missing history and safe-integer limits without formatting invalid values", () => {
  const format = (value: number) => formatAccountMoney(value, "USD", "en");
  expect(chartMoneyLayout([], format).axisWidth).toBeGreaterThan(0);
  expect(chartMoneyLayout([null], format)).toEqual(chartMoneyLayout([], format));
  expect(chartMoneyLayout([Number.MAX_SAFE_INTEGER], format).axisWidth).toBeGreaterThan(150);
});
