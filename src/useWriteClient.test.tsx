// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { useWriteClient } from "./useWriteClient";
import { quietWrite } from "./writeCancellation";
const h = vi.hoisted(() => ({ updateCategory: vi.fn() }));
vi.mock("./api", () => ({ api: h }));
function Page({ lang = "en" }: { lang?: "zh" | "en" }) {
  const [busy, setBusy] = useState(false);
  const { client, conflictDialog } = useWriteClient({ categoryRevision: 2 }, lang);
  return <>{conflictDialog}<span>{busy ? "Saving" : "Idle"}</span><button onClick={quietWrite(async () => { setBusy(true); try { await client.updateCategory("c", { note: "my draft" }); } finally { setBusy(false); } })}>Save</button></>;
}
beforeEach(() => { h.updateCategory.mockReset(); });
afterEach(cleanup);
it("updates an open conflict when language changes while preserving names, draft and currency amounts", async () => {
  h.updateCategory.mockRejectedValue({ code: "category_revision_conflict", categoryRevision: 3, groups: [{ id: "g", name: "家庭 {value}", categories: [{ id: "c", name: "餐饮 Food", note: "对方原文", hidden: true }] }], accounts: [{ id: "a", name: "旅行 SGD", balance: 12345, currencyCode: "SGD" }] });
  const view = render(<Page lang="zh" />);
  fireEvent.click(screen.getByText("Save"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog.textContent).toContain("共享分类已在另一设备更新");
  expect(dialog.textContent).toContain("备注：my draft");
  expect(dialog.textContent).toMatch(/SGD\s123\.45/);
  view.rerender(<Page lang="en" />);
  expect(dialog.textContent).toContain("Shared categories were updated on another device");
  expect(dialog.textContent).toContain("Note：my draft");
  expect(dialog.textContent).toContain("家庭 {value}");
  expect(dialog.textContent).toContain("餐饮 Food");
  expect(dialog.textContent).toMatch(/SGD\s123\.45/);
  expect(dialog.textContent).not.toContain("共享分类已在另一设备更新");
  expect(h.updateCategory).toHaveBeenCalledTimes(1);
});
it("keeps a conflict pending until the user explicitly retries with the returned revision", async () => {
  h.updateCategory.mockRejectedValueOnce({ code: "category_revision_conflict", categoryRevision: 3, groups: [{ id: "g", name: "Group", categories: [{ id: "c", name: "Food", note: "other draft" }] }] }).mockResolvedValueOnce({ ok: true });
  render(<Page />);
  fireEvent.click(screen.getByText("Save"));
  await screen.findByText("Shared categories were updated on another device");
  expect(screen.getByText(/other draft/)).toBeTruthy();
  expect(h.updateCategory).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Retry my changes"));
  await waitFor(() => expect(h.updateCategory).toHaveBeenCalledTimes(2));
  expect(h.updateCategory.mock.calls[1]).toEqual(["c", { note: "my draft" }, 3]);
});
it("Escape cancels without retry, settles finally, and restores focus", async () => {
  h.updateCategory.mockRejectedValue({ code: "category_revision_conflict", categoryRevision: 3, groups: [] });
  render(<Page />);
  const save = screen.getByText("Save");
  save.focus();
  fireEvent.click(save);
  const dialog = await screen.findByRole("dialog");
  expect(document.activeElement === screen.getByText("Retry my changes")).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(document.activeElement === screen.getByText("Cancel")).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await screen.findByText("Idle");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement === save).toBe(true);
  expect(h.updateCategory).toHaveBeenCalledTimes(1);
});
it("does not issue a second write while the first operation is pending", async () => {
  let release!: (value: { ok: true }) => void;
  h.updateCategory.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  render(<Page />);
  fireEvent.click(screen.getByText("Save"));
  fireEvent.click(screen.getByText("Save"));
  expect(h.updateCategory).toHaveBeenCalledTimes(1);
  release({ ok: true });
  await screen.findByText("Idle");
});
