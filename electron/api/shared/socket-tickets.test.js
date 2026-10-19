import { expect, test } from "vitest";
import { createSocketTickets } from "./socket-tickets.js";

test("a ticket is redeemed once", () => {
  const tickets = createSocketTickets();
  const principal = { kind: "local" };
  const ticket = tickets.issue(principal);

  expect(tickets.redeem(ticket)).toBe(principal);
  expect(tickets.redeem(ticket)).toBeNull();
});

test("an expired or unknown ticket is refused", () => {
  let time = 0;
  const tickets = createSocketTickets({ ttlMs: 1000, now: () => time });
  const ticket = tickets.issue();
  time = 1000;

  expect(tickets.redeem(ticket)).toBeNull();
  expect(tickets.redeem("nope")).toBeNull();
  expect(tickets.redeem(undefined)).toBeNull();
});
