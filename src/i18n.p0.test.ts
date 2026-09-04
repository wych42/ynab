import { describe, expect, it } from "vitest";
import { dicts } from "./i18n";

describe("P0 currency role i18n", () => {
  it("has Chinese and English labels for the new page roles", () => {
    expect(dicts.zh.budget_currency).toBe("预算账本");
    expect(dicts.en.budget_currency).toBe("Budget ledger");
    expect(dicts.zh.rep_viewCurrency).toBe("查看币种");
    expect(dicts.en.rep_viewCurrency).toBe("View currency");
    expect(dicts.zh.rep_convertTo).toBe("折算为");
    expect(dicts.en.rep_convertTo).toBe("Convert to");
    expect(dicts.zh.settings_reportingCurrency).toBe("净资产默认币种");
    expect(dicts.en.settings_reportingCurrency).toBe("Default net-worth currency");
    expect(dicts.zh.tx_accountBooked).toBe("账户入账");
    expect(dicts.en.tx_accountBooked).toBe("Account booked");
    expect(dicts.zh.tx_merchantPrice).toBe("商户计价");
    expect(dicts.en.tx_merchantPrice).toBe("Merchant amount");
    expect(dicts.zh.tx_transferOut).toBe("转出");
    expect(dicts.en.tx_transferOut).toBe("Sent");
    expect(dicts.zh.tx_transferIn).toBe("入账");
    expect(dicts.en.tx_transferIn).toBe("Received");
    expect(dicts.zh.settings_inUse).toBe("使用中");
    expect(dicts.en.settings_inUse).toBe("In use");
    expect(dicts.zh.rep_inactive).toBe("无活动");
    expect(dicts.en.rep_inactive).toBe("Inactive");
  });
});
