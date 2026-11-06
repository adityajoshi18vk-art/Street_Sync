import { test } from "node:test";
import assert from "node:assert/strict";
import { reportReadiness, type ReportReadinessInput } from "../src/lib/readiness";

const ready: ReportReadinessInput = {
  isConnected: true, onActiveChain: true, contractsDeployed: true, hasPin: true, hasPhoto: true,
  descriptionLength: 20, minDescription: 8, maxDescription: 500,
  amount: 2_000n, amountInput: "0.002", balance: 5_000_000n, hasExpiry: true
};
const missing = (i: ReportReadinessInput) => reportReadiness(i).items.filter((x) => !x.done).map((x) => x.key);

test("a complete form is ready", () => {
  assert.equal(reportReadiness(ready).ready, true);
  assert.deepEqual(missing(ready), []);
});

test("a missing pin is reported (the case behind the disabled button)", () => {
  assert.deepEqual(missing({ ...ready, hasPin: false }), ["pin"]);
});

test("wallet, network, photo, description and amount problems are each named", () => {
  assert.deepEqual(missing({ ...ready, isConnected: false }), ["wallet", "network"]);
  assert.deepEqual(missing({ ...ready, onActiveChain: false }), ["network"]);
  assert.deepEqual(missing({ ...ready, hasPhoto: false }), ["photo"]);
  assert.deepEqual(missing({ ...ready, descriptionLength: 3 }), ["description"]);
  assert.deepEqual(missing({ ...ready, amount: null, amountInput: "abc" }), ["amount"]);
  assert.match(reportReadiness({ ...ready, amount: null, amountInput: "abc" }).items.find((x) => x.key === "amount")!.label, /valid/);
});

test("insufficient USDC blocks, unknown balance does not", () => {
  assert.deepEqual(missing({ ...ready, balance: 1_000n }), ["balance"]);
  assert.deepEqual(missing({ ...ready, balance: null }), []);
});
