import { describe, expect, test } from "vitest";

import { ScheduleCadenceSchema, ScheduleRunSchema } from "./types.js";

describe("ScheduleCadenceSchema", () => {
  test("accepts existing UTC cron cadence without a time zone", () => {
    expect(ScheduleCadenceSchema.parse({ type: "cron", expression: "0 9 * * *" })).toEqual({
      type: "cron",
      expression: "0 9 * * *",
    });
  });

  test("accepts timezone-aware cron cadence", () => {
    expect(
      ScheduleCadenceSchema.parse({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      }),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "America/New_York",
    });
  });
});

describe("ScheduleRunSchema", () => {
  test("represents skipped runs without widening the legacy status enum", () => {
    const run = {
      id: "run-1",
      scheduledFor: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:01.000Z",
      status: "succeeded",
      skipped: true,
      agentId: null,
      output: "Gate exited 1; nothing to do",
      error: null,
    };

    expect(ScheduleRunSchema.parse(run)).toEqual(run);
    expect(ScheduleRunSchema.safeParse({ ...run, status: "skipped" }).success).toBe(false);
  });
});
