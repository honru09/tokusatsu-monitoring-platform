import { describe, expect, it } from "vitest";
import { packParcel, packedTotal, type PackingStock } from "./shipping-packing";

const stock = (
  orderId: string,
  unitDeclaredYen: number,
  available: number,
  purchasedAt: string | null = "2026-01-01T00:00:00.000Z",
): PackingStock => ({
  orderId,
  unitDeclaredYen,
  available,
  purchasedAt,
  createdAt: purchasedAt ?? "2026-01-01T00:00:00.000Z",
});

describe("packParcel", () => {
  it("fills the parcel as close to the cap as the stock allows", () => {
    const lines = packParcel(
      [stock("a", 700, 1), stock("b", 650, 1), stock("c", 600, 1)],
      2000,
    );
    expect(packedTotal(lines)).toBe(1950);
    expect(lines).toHaveLength(3);
  });

  it("respects bounded quantities per order", () => {
    const lines = packParcel([stock("a", 300, 3)], 2000);
    expect(lines).toEqual([
      { orderId: "a", quantity: 3, unitDeclaredYen: 300 },
    ]);
    expect(packedTotal(lines)).toBe(900);
  });

  it("prefers an exact-cap combination over a looser one", () => {
    const lines = packParcel(
      [stock("a", 1000, 1), stock("b", 900, 1), stock("c", 100, 1)],
      2000,
    );
    expect(packedTotal(lines)).toBe(2000);
  });

  it("clears older stock first when totals tie", () => {
    const lines = packParcel(
      [
        stock("new", 500, 2, "2026-02-01T00:00:00.000Z"),
        stock("old", 500, 2, "2026-01-01T00:00:00.000Z"),
      ],
      1000,
    );
    expect(lines).toEqual([
      { orderId: "old", quantity: 2, unitDeclaredYen: 500 },
    ]);
  });

  it("excludes units priced above the cap and zero-priced units", () => {
    const lines = packParcel(
      [stock("big", 2500, 1), stock("free", 0, 5), stock("ok", 800, 1)],
      2000,
    );
    expect(lines).toEqual([
      { orderId: "ok", quantity: 1, unitDeclaredYen: 800 },
    ]);
  });

  it("returns an empty parcel when nothing fits", () => {
    expect(packParcel([stock("big", 2500, 2)], 2000)).toEqual([]);
    expect(packParcel([], 2000)).toEqual([]);
    expect(packParcel([stock("a", 100, 1)], 0)).toEqual([]);
  });
});
