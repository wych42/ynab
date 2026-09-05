type EmptyBudget = { readyToAssign: number; incomeThisMonth: number; assignedTotal: number; groups: { categories: { assigned: number; activity: number; available: number }[] }[] };
export function budgetNeedsFunding(data: EmptyBudget, accounts: { balance: number }[]) {
  return accounts.length > 0 && accounts.every(a => a.balance === 0) && data.readyToAssign === 0 && data.incomeThisMonth === 0 && data.assignedTotal === 0 && data.groups.every(g => g.categories.every(c => c.assigned === 0 && c.activity === 0 && c.available === 0));
}
