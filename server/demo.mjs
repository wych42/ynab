import { addMonths, db as defaultDatabase, isValidTimezone, nowIso as defaultNowIso, uid as defaultUid, ymd } from "./db.mjs";
import { createAccountRecord, setReportingCurrency } from "./account-currency.mjs";
import { postTransaction, postTransfer, reconcileAccount } from "./currency-ledger.mjs";
import { assignBudget, setGoal } from "./finance-tools.mjs";
import { addUtcDays, createFxModule, createInMemoryFxAdapter } from "./fx.mjs";

const GROCERY_PAYEES = ["盒马鲜生", "永辉超市", "美团买菜", "山姆会员店"];
const DINING_PAYEES = ["麦当劳", "海底捞", "美团外卖", "瑞幸咖啡", "兰州拉面", "肯德基"];
const TRANSPORT_PAYEES = ["滴滴出行", "地铁充值", "哈啰单车"];

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readTimezone(database) {
  const value = database.prepare("SELECT value FROM settings WHERE key='timezone'").get()?.value;
  if (value && isValidTimezone(value)) return value;
  return "UTC";
}

function monthDate(month, day, today) {
  const [year, monthNumber] = month.split("-").map(Number);
  const dim = new Date(year, monthNumber, 0).getDate();
  const date = `${month}-${String(Math.min(day, dim)).padStart(2, "0")}`;
  return date > today ? today : date;
}

function categoryIds(database) {
  const map = {};
  for (const row of database.prepare("SELECT id, name FROM categories").all()) {
    map[row.name] = row.id;
  }
  return map;
}

function requireCategory(cats, name) {
  const id = cats[name];
  if (!id) throw new Error(`demo data is missing category ${name}`);
  return id;
}

function addAccount(database, input, clock) {
  return createAccountRecord(
    database,
    {
      name: input.name,
      type: input.type,
      currencyCode: input.currencyCode,
      startingBalanceMinor: input.startingBalanceMinor,
      startingDate: input.startingDate,
    },
    { requireCurrency: true, uid: clock.uid, nowIso: clock.nowIso, todayYmd: clock.today }
  );
}

export function loadDemoData({ database = defaultDatabase, now = new Date(), uid = defaultUid, nowIso = defaultNowIso } = {}) {
  const timeZone = readTimezone(database);
  const today = ymd(now, timeZone);
  const thisMonth = today.slice(0, 7);
  const rateDate = addUtcDays(today, -3);
  const startingDate = `${addMonths(thisMonth, -6)}-25`;
  const months = [];
  for (let i = 5; i >= 0; i--) months.push(addMonths(thisMonth, -i));
  const clock = { uid, nowIso, today };
  const rand = mulberry32(20260825);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const fx = createFxModule({
    db: database,
    provider: createInMemoryFxAdapter({ source: "demo_offline" }),
    today: () => today,
    nowIso,
  });

  const run = database.transaction(() => {
    setReportingCurrency(database, "CNY");

    const accounts = {
      bank: addAccount(
        database,
        { name: "家庭 CNY 日常账户", type: "checking", currencyCode: "CNY", startingBalanceMinor: 960_000, startingDate },
        clock
      ),
      alipay: addAccount(
        database,
        { name: "支付宝", type: "cash", currencyCode: "CNY", startingBalanceMinor: 68_000, startingDate },
        clock
      ),
      wechat: addAccount(
        database,
        { name: "微信钱包", type: "cash", currencyCode: "CNY", startingBalanceMinor: 42_000, startingDate },
        clock
      ),
      save: addAccount(
        database,
        { name: "定期储蓄账户", type: "savings", currencyCode: "CNY", startingBalanceMinor: 1_800_000, startingDate },
        clock
      ),
      credit: addAccount(
        database,
        { name: "CNY 信用卡", type: "creditCard", currencyCode: "CNY", startingBalanceMinor: -236_000, startingDate },
        clock
      ),
      usdCard: addAccount(
        database,
        { name: "USD 信用卡", type: "creditCard", currencyCode: "USD", startingBalanceMinor: 0, startingDate },
        clock
      ),
      invest: addAccount(
        database,
        { name: "USD 投资账户", type: "investment", currencyCode: "USD", startingBalanceMinor: 800_000, startingDate },
        clock
      ),
      sgd: addAccount(
        database,
        { name: "SGD 日常账户", type: "checking", currencyCode: "SGD", startingBalanceMinor: 500_000, startingDate },
        clock
      ),
      jpy: addAccount(
        database,
        { name: "JPY 现金", type: "cash", currencyCode: "JPY", startingBalanceMinor: 100_000, startingDate },
        clock
      ),
    };
    addAccount(
      database,
      { name: "EUR 备用账户", type: "checking", currencyCode: "EUR", startingBalanceMinor: 0, startingDate },
      clock
    );

    const cats = categoryIds(database);
    const salary = requireCategory(cats, "工资薪酬");
    const dining = requireCategory(cats, "餐饮外出");
    const groceries = requireCategory(cats, "食品杂货");
    const transport = requireCategory(cats, "交通出行");
    const household = requireCategory(cats, "日用百货");
    const phone = requireCategory(cats, "话费网费");
    const rent = requireCategory(cats, "房租房贷");
    const utilities = requireCategory(cats, "水电燃气");
    const subscription = requireCategory(cats, "订阅服务");
    const insurance = requireCategory(cats, "医疗保险");
    const emergency = requireCategory(cats, "应急基金");
    const travel = requireCategory(cats, "旅行基金");
    const medical = requireCategory(cats, "医疗健康");
    const investing = requireCategory(cats, "投资理财");

    setGoal(database, { currencyCode: "CNY", categoryId: emergency, type: "targetBalance", targetMinor: 3_000_000 });
    setGoal(database, { currencyCode: "CNY", categoryId: travel, type: "targetByDate", targetMinor: 1_200_000, targetMonth: "2027-02-01" });
    for (const categoryId of [rent, utilities, subscription, insurance]) {
      setGoal(database, { currencyCode: "CNY", categoryId, type: "monthly", targetMinor: 0 });
    }
    setGoal(database, { currencyCode: "SGD", categoryId: emergency, type: "targetBalance", targetMinor: 800_000 });

    const book = (input) => postTransaction(database, { ...input, cleared: true });
    const move = (input) => postTransfer(database, { ...input, cleared: true });

    for (const month of months) {
      const D = (day) => monthDate(month, day, today);
      assignBudget(database, { currencyCode: "CNY", month, categoryId: groceries, assignedMinor: 140_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: dining, assignedMinor: 90_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: transport, assignedMinor: 30_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: household, assignedMinor: 25_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: phone, assignedMinor: 15_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: rent, assignedMinor: 420_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: utilities, assignedMinor: 30_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: subscription, assignedMinor: 6_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: insurance, assignedMinor: 22_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: emergency, assignedMinor: 160_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: travel, assignedMinor: 70_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: medical, assignedMinor: 10_000 });
      assignBudget(database, { currencyCode: "CNY", month, categoryId: `cc:${accounts.credit}`, assignedMinor: 50_000 });
      assignBudget(database, { currencyCode: "SGD", month, categoryId: dining, assignedMinor: 20_000 });
      assignBudget(database, { currencyCode: "SGD", month, categoryId: groceries, assignedMinor: 40_000 });

      book({ accountId: accounts.bank, date: D(10), payeeName: "公司发薪", amount: 1_280_000, categoryId: salary, memo: "工资入账" });
      book({ accountId: accounts.bank, date: D(1), payeeName: "房东张女士", amount: -420_000, categoryId: rent });
      book({ accountId: accounts.bank, date: D(16), payeeName: "供电局", amount: -18_000, categoryId: utilities });
      book({ accountId: accounts.bank, date: D(17), payeeName: "燃气公司", amount: -7_000, categoryId: utilities });
      book({ accountId: accounts.bank, date: D(18), payeeName: "中国电信", amount: -8_800, categoryId: phone });
      book({ accountId: accounts.bank, date: D(19), payeeName: "中国移动", amount: -3_900, categoryId: phone });
      book({ accountId: accounts.bank, date: D(21), payeeName: "iCloud+ Netflix", amount: -5_200, categoryId: subscription });
      book({ accountId: accounts.bank, date: D(22), payeeName: "平安保险", amount: -21_000, categoryId: insurance });

      move({ fromId: accounts.bank, toId: accounts.alipay, date: D(2), fromAmountMinor: 220_000, memo: "充值" });
      move({ fromId: accounts.bank, toId: accounts.wechat, date: D(9), fromAmountMinor: 90_000, memo: "充值" });
      move({ fromId: accounts.bank, toId: accounts.save, date: D(25), fromAmountMinor: 150_000, memo: "月度储蓄" });
      move({ fromId: accounts.bank, toId: accounts.credit, date: D(28), fromAmountMinor: 130_000, memo: "还上月账单" });

      book({ accountId: accounts.credit, date: D(3), payeeName: pick(GROCERY_PAYEES), amount: -30_000, categoryId: groceries });
      book({ accountId: accounts.credit, date: D(10), payeeName: pick(GROCERY_PAYEES), amount: -30_000, categoryId: groceries });
      book({ accountId: accounts.alipay, date: D(5), payeeName: pick(GROCERY_PAYEES), amount: -25_000, categoryId: groceries });
      book({ accountId: accounts.alipay, date: D(12), payeeName: pick(GROCERY_PAYEES), amount: -25_000, categoryId: groceries });
      book({ accountId: accounts.credit, date: D(4), payeeName: pick(DINING_PAYEES), amount: -5_000, categoryId: dining });
      book({ accountId: accounts.credit, date: D(11), payeeName: pick(DINING_PAYEES), amount: -5_000, categoryId: dining });
      book({ accountId: accounts.credit, date: D(18), payeeName: pick(DINING_PAYEES), amount: -5_000, categoryId: dining });
      book({ accountId: accounts.credit, date: D(25), payeeName: pick(DINING_PAYEES), amount: -5_000, categoryId: dining });
      book({ accountId: accounts.wechat, date: D(6), payeeName: pick(DINING_PAYEES), amount: -4_000, categoryId: dining });
      book({ accountId: accounts.wechat, date: D(13), payeeName: pick(DINING_PAYEES), amount: -4_000, categoryId: dining });
      book({ accountId: accounts.wechat, date: D(20), payeeName: pick(DINING_PAYEES), amount: -4_000, categoryId: dining });
      book({ accountId: accounts.wechat, date: D(7), payeeName: pick(TRANSPORT_PAYEES), amount: -2_000, categoryId: transport });
      book({ accountId: accounts.wechat, date: D(14), payeeName: pick(TRANSPORT_PAYEES), amount: -2_000, categoryId: transport });
      book({ accountId: accounts.wechat, date: D(21), payeeName: pick(TRANSPORT_PAYEES), amount: -2_000, categoryId: transport });
      book({ accountId: accounts.alipay, date: D(15), payeeName: "屈臣氏", amount: -10_000, categoryId: household });
    }

    book({
      accountId: accounts.sgd,
      date: monthDate(thisMonth, 10, today),
      payeeName: "新加坡公司发薪",
      amount: 300_000,
      categoryId: salary,
      memo: "SGD 工资入账",
    });
    move({
      fromId: accounts.sgd,
      toId: accounts.bank,
      date: monthDate(thisMonth, 15, today),
      fromAmountMinor: 10_000,
      toAmountMinor: 55_000,
      payeeName: "OCBC",
      memo: "跨币种换汇",
    });
    book({
      accountId: accounts.usdCard,
      date: monthDate(thisMonth, 20, today),
      payeeName: "Cafe de Paris",
      amount: -2_200,
      categoryId: dining,
      originalCurrencyCode: "EUR",
      originalAmountMinor: 2_000,
      memo: "外币刷卡",
    });
    book({
      accountId: accounts.jpy,
      date: monthDate(thisMonth, 12, today),
      payeeName: "一兰拉面",
      amount: -1_200,
      categoryId: dining,
    });
    move({
      fromId: accounts.bank,
      toId: accounts.invest,
      date: `${addMonths(thisMonth, -3)}-08`,
      fromAmountMinor: 1_440_000,
      toAmountMinor: 200_000,
      categoryId: investing,
      payeeName: "证券转出",
      memo: "加仓定投",
    });
    reconcileAccount(database, {
      accountId: accounts.invest,
      statementBalance: 1_050_000,
      asOfDate: today,
    });

    fx.putManualRate({ rateDate, baseCurrency: "USD", quoteCurrency: "CNY", rate: "7.20" });
    fx.putManualRate({ rateDate, baseCurrency: "SGD", quoteCurrency: "CNY", rate: "5.40" });
    fx.putManualRate({ rateDate, baseCurrency: "JPY", quoteCurrency: "CNY", rate: "0.050" });
  });
  run();
}
