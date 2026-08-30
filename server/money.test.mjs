import { describe, expect, it } from "vitest";
import { defineMoneyTests } from "../shared/money-cases.mjs";
import * as money from "./money.mjs";

defineMoneyTests({ describe, it, expect, money });
