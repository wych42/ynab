import { expect, it } from "vitest";
import { budgetNeedsFunding } from "./budgetEmptyState";
it("explains an unfunded zero account without hiding a fully allocated budget", () => {
  expect(budgetNeedsFunding({ readyToAssign: 0, incomeThisMonth: 0, assignedTotal: 0, groups: [{ categories: [{ assigned: 0, activity: 0, available: 0 }] }] }, [{ balance: 0 }])).toBe(true);
  expect(budgetNeedsFunding({ readyToAssign: 0, incomeThisMonth: 1000, assignedTotal: 1000, groups: [{ categories: [{ assigned: 1000, activity: 0, available: 1000 }] }] }, [{ balance: 1000 }])).toBe(false);
  expect(budgetNeedsFunding({ readyToAssign: 0, incomeThisMonth: 0, assignedTotal: 0, groups: [{ categories: [{ assigned: 0, activity: 0, available: 1000 }] }] }, [{ balance: 1000 }])).toBe(false);
});
