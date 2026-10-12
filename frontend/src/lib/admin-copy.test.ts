import { describe, expect, it } from "vitest";
import { ACTION_LABEL, MODEL_SOURCE_LABEL, describeChange, formatUsd } from "./admin-copy";

describe("admin copy", () => {
  it("formats service costs", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0745)).toBe("$0.075");
    expect(formatUsd(7.9)).toBe("$7.90");
  });

  it("labels the model-management audit actions and version sources in Thai", () => {
    for (const action of ["llm_config.save", "llm_config.restore", "llm_config.reset", "llm.test"]) expect(ACTION_LABEL[action]).toBeTruthy();
    expect(MODEL_SOURCE_LABEL).toEqual({ edit: "แก้ไข", restore: "ย้อนกลับ", file: "จาก llm.yaml" });
  });

  it("describes a change field by field", () => {
    expect(describeChange({ daily_quota: 10 }, { daily_quota: 25 })).toEqual(["daily_quota: 10 → 25"]);
    expect(describeChange(null, { username: "owner", is_admin: false })).toEqual(["is_admin: false", "username: owner"]);
    expect(describeChange({ topic: "t", status: "done" }, null)).toEqual(["status: done", "topic: t"]);
    expect(describeChange(null, null)).toEqual([]);
  });
});
