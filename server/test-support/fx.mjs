export {
  createFrankfurterEcbAdapter,
  createInMemoryFxAdapter,
} from "../fx.mjs";

export const FIXTURE_RATES_2026_08_28 = [
  { rateDate: "2026-08-28", baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.20" },
  { rateDate: "2026-08-28", baseCurrency: "SGD", quoteCurrency: "CNY", rate: "5.40" },
  { rateDate: "2026-08-28", baseCurrency: "JPY", quoteCurrency: "CNY", rate: "0.050" },
];
