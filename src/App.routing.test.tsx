// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
const state = vi.hoisted(() => ({ lang: "zh" as "zh" | "en" }));
vi.mock("./store", async () => {
  const { makeT } = await import("./i18n");
  return { AppProvider: ({ children }: { children: ReactNode }) => children, useApp: () => ({ loading: false, authEnabled: false, authenticated: true, boot: {}, t: makeT(state.lang) }) };
});
vi.mock("./components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./pages/BudgetPage", () => ({ BudgetPage: () => <p>Budget</p> }));
vi.mock("./pages/AccountsPage", () => ({ AccountsPage: () => <p>Accounts list</p> }));
vi.mock("./pages/AccountDetailPage", () => ({ AccountDetailPage: ({ id }: { id: string }) => <p data-testid="account-detail">{id}</p> }));
vi.mock("./pages/ReportsPage", () => ({ ReportsPage: () => null }));
vi.mock("./pages/TransactionsPage", () => ({ TransactionsPage: () => null }));
vi.mock("./pages/ChatPage", () => ({ ChatPage: () => null }));
vi.mock("./pages/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./pages/LoginPage", () => ({ LoginPage: () => null }));
vi.mock("./pages/CurrencyMigrationPage", () => ({ CurrencyMigrationPage: () => null }));
import App from "./App";
beforeEach(() => { state.lang = "zh"; window.history.replaceState({}, "", "#/accounts"); });
afterEach(cleanup);

it.each(["", "?x=1", "?id=another&currency=USD"])("preserves the exact account id with query %s", query => {
  window.history.replaceState({}, "", `#/accounts/20d3159e-679b-466b-aedc-787681e47700${query}`);
  render(<App />);
  expect(screen.getByTestId("account-detail").textContent).toBe("20d3159e-679b-466b-aedc-787681e47700");
  expect(screen.queryByText("Accounts list")).toBeNull();
});
it.each(["", "a/b", "a%2Fb", "a.b", "a%3Fb"])("does not broaden account-id matching for %s", id => {
  window.history.replaceState({}, "", `#/accounts/${id}?x=1`);
  render(<App />);
  expect(screen.queryByTestId("account-detail")).toBeNull();
  expect(screen.getByText("Accounts list")).toBeTruthy();
});
it("passes an unknown well-formed id unchanged to the detail page for its existing not-found handling", () => {
  window.history.replaceState({}, "", "#/accounts/nonexistent-id?x=1");
  render(<App />);
  expect(screen.getByTestId("account-detail").textContent).toBe("nonexistent-id");
});
it.each([ ["zh", "打开导航菜单", "关闭导航菜单"], ["en", "Open navigation menu", "Close navigation menu"] ] as const)("labels navigation actions and expanded state in %s", (lang, open, close) => {
  state.lang = lang;
  render(<App />);
  expect(screen.getByRole("button", { name: open }).getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: open }));
  expect(screen.getByRole("button", { name: close }).getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: close }));
  expect(screen.getByRole("button", { name: open }).getAttribute("aria-expanded")).toBe("false");
});
