import { describe, expect, it } from "vitest";
import { householdToday, resolveNetWorthRoute } from "./netWorthRoute";

const defaults = { today: "2026-09-05", enabled: ["CNY", "USD"], supported: ["CNY", "USD", "CAD"], fallback: "CNY" };
const resolve = (query: string) => resolveNetWorthRoute(`#/reports/net-worth${query}`, defaults);

describe("net-worth route date resolution", () => {
  it("defaults missing date without warning and explains an explicit empty date", () => {
    expect(resolve("")).toMatchObject({ asOf: defaults.today, dateNotice: null, hash: "#/reports/net-worth?currency=CNY&asOf=2026-09-05" });
    expect(resolve("?asOf=")).toMatchObject({ asOf: defaults.today, dateNotice: "invalid" });
  });
  it.each(["bad", "2026-02-30", "2026-2-03", "2026-13-01", "0000-01-01", "0099-01-01", "2025-02-29", "2026-09-04T00:00:00Z", "%202026-09-04"])("recovers malformed date %s", value => {
    expect(resolve(`?asOf=${value}`)).toMatchObject({ asOf: defaults.today, dateNotice: "invalid" });
  });
  it.each(["2026-09-06", "2099-01-01"])("recovers future date %s", value => {
    expect(resolve(`?asOf=${value}`)).toMatchObject({ asOf: defaults.today, dateNotice: "future" });
  });
  it.each(["2026-09-05", "2024-02-29", "2026-01-01"])("preserves legitimate date %s and explicit currency", asOf => {
    expect(resolve(`?currency=USD&asOf=${asOf}`)).toMatchObject({ asOf, currency: "USD", dateNotice: null, currencyNotice: null });
  });
  it("repairs both fields in one canonical destination and retains unrelated parameters", () => {
    expect(resolve("?currency=CAD&asOf=2099-01-01&extra=keep")).toEqual({
      currency: "CNY", asOf: defaults.today, dateNotice: "future",
      currencyNotice: { reason: "disabled", requested: "CAD", fallback: "CNY" },
      hash: "#/reports/net-worth?currency=CNY&asOf=2026-09-05&extra=keep",
    });
  });
  it("retains historical date when only currency needs repair", () => {
    expect(resolve("?currency=XYZ&asOf=2024-02-29")).toMatchObject({ asOf: "2024-02-29", dateNotice: null, currencyNotice: { reason: "unsupported" } });
  });
  it("rejects duplicate date values even if the last date is valid", () => {
    expect(resolve("?asOf=bad&asOf=2024-02-29")).toMatchObject({ asOf: defaults.today, dateNotice: "invalid" });
  });
  it("uses the household timezone at a fixed UTC boundary", () => {
    const instant = new Date("2026-09-04T16:30:00Z");
    expect(householdToday("Asia/Singapore", instant)).toBe("2026-09-05");
    expect(householdToday("UTC", instant)).toBe("2026-09-04");
    expect(householdToday("America/Los_Angeles", instant)).toBe("2026-09-04");
    expect(householdToday("Pacific/Kiritimati", instant)).toBe("2026-09-05");
  });
});
