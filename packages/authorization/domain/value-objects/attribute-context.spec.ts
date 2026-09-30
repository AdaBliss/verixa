import { describe, expect, it } from "vitest";

import { AttributeContext } from "./attribute-context.js";

describe("AttributeContext", () => {
  const date = new Date("2026-09-30T12:00:00.000Z");
  const context = new AttributeContext({
    subject: { id: "user-1", age: 30, active: true, roles: ["reader"], createdAt: date },
    resource: { owner: { id: "user-1" } },
    action: { name: "read" },
    environment: { ip: "192.0.2.1" },
  });

  it("provides typed lookups across all four attribute bags", () => {
    expect(context.getString("subject", "id")).toBe("user-1");
    expect(context.getNumber("subject", "age")).toBe(30);
    expect(context.getBoolean("subject", "active")).toBe(true);
    expect(context.getArray("subject", "roles")).toEqual(["reader"]);
    expect(context.getDate("subject", "createdAt")?.toISOString()).toBe(date.toISOString());
    expect(context.getString("resource", "owner.id")).toBe("user-1");
    expect(context.getString("action", "name")).toBe("read");
    expect(context.getString("environment", "ip")).toBe("192.0.2.1");
  });

  it("returns undefined for missing paths and type mismatches", () => {
    expect(context.getString("subject", "missing")).toBeUndefined();
    expect(context.getString("subject", "age")).toBeUndefined();
    expect(context.get("resource", "owner.missing")).toBeUndefined();
    expect(context.get("environment", "ip.invalid.path")).toBeUndefined();
  });

  it("copies and freezes input so callers cannot mutate the context", () => {
    const source = { subject: { roles: ["reader"] } };
    const immutable = new AttributeContext(source);
    source.subject.roles.push("admin");

    expect(immutable.getArray("subject", "roles")).toEqual(["reader"]);
    expect(Object.isFrozen(immutable)).toBe(true);
    expect(Object.isFrozen(immutable.subject)).toBe(true);
    expect(Object.isFrozen(immutable.getArray("subject", "roles"))).toBe(true);
  });
});
