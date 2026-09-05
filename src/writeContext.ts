export type WriteSnapshot = { ledgerRevisions?: Record<string, number>; categoryRevision?: number };
const bodyIndex: Record<string, number> = { createAccount: 0, updateAccount: 1, createTx: 0, updateTx: 1, reconcile: 1 };
const versionIndex: Record<string, number> = { deleteAccount: 1, deleteTx: 1, setTxStatus: 2, setTxCategory: 2, bulkSetCategory: 2, bulkDeleteTx: 1 };
const categoryIndex: Record<string, number> = { addGroup: 1, renameGroup: 2, deleteGroup: 1, addCategory: 2, renameCategory: 2, updateCategory: 2, deleteCategory: 1 };
const budgetIndex: Record<string, number> = { assign: 4, moveMoney: 5, coverOverspending: 4, autoAssign: 2, copyLastMonth: 2, setGoal: 3, clearGoal: 2 };
export function isVersionedWrite(name: string) {
  return name in bodyIndex || name in versionIndex || name in categoryIndex || name in budgetIndex;
}
export function writeArguments(name: string, args: unknown[], snapshot: WriteSnapshot, retry = false): unknown[] {
  const result = [...args];
  if (name in bodyIndex) {
    const i = bodyIndex[name];
    result[i] = { ...(args[i] as object ?? {}), expectedRevision: snapshot.ledgerRevisions };
  } else if (name in versionIndex) result[versionIndex[name]] = snapshot.ledgerRevisions;
  else if (name in categoryIndex) result[categoryIndex[name]] = snapshot.categoryRevision;
  else if (retry && name in budgetIndex) {
    const i = budgetIndex[name];
    const currency = args[i - 1] as string;
    result[i] = snapshot.ledgerRevisions?.[currency];
  }
  return result;
}
