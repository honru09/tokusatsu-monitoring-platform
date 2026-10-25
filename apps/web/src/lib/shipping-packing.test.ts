import { describe, expect, it } from "vitest";
import {
  bandJpyFromCny,
  capJpyFromCny,
  packParcel,
  packedTotal,
  toCny,
  toCny1dp,
  type PackingStock,
} from "./shipping-packing";

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

  it("packs a parcel into the 1,800-1,900 CNY band at rate 0.0425", () => {
    const rate = 0.0425;
    const capJpy = capJpyFromCny(2000, rate);
    const lines = packParcel(
      [stock("a", 15000, 2), stock("b", 13500, 1), stock("big", 50000, 1)],
      capJpy,
    );
    const totalJpy = packedTotal(lines);
    expect(totalJpy).toBe(43500);
    const totalCny = toCny(totalJpy, rate);
    expect(totalCny).toBe(1848);
    expect(totalCny).toBeGreaterThanOrEqual(1800);
    expect(totalCny).toBeLessThanOrEqual(1900);
    const band = bandJpyFromCny(1800, 1900, rate);
    expect(totalJpy).toBeGreaterThan(band.minJpy);
    expect(totalJpy).toBeLessThanOrEqual(capJpy);
  });
});

describe("CNY conversion helpers", () => {
  const rate = 0.0425;

  it("floors the JPY cap so the exact CNY value stays under the cap", () => {
    // 2000 / 0.0425 = 47058.82...; rounding to nearest would give
    // 47059 yen, whose exact CNY value (2000.0075) exceeds the cap.
    expect(capJpyFromCny(2000, rate)).toBe(47058);
    expect(47058 * rate).toBeLessThanOrEqual(2000);
    expect(47059 * rate).toBeGreaterThan(2000);
  });

  it("derives the band's JPY display bounds from the CNY band", () => {
    expect(bandJpyFromCny(1800, 1900, rate)).toEqual({
      minJpy: 42353,
      maxJpy: 44705,
    });
  });

  it("floors CNY totals so a displayed total never overstates", () => {
    // 43,500 yen is exactly 1848.75 CNY; floor keeps 1848.
    expect(toCny(43500, rate)).toBe(1848);
    // A parcel packed right up to the JPY cap converts to 1999 CNY,
    // never a rounded-up 2000.
    expect(toCny(47058, rate)).toBe(1999);
    expect(toCny(47058, rate)).toBeLessThanOrEqual(2000);
    expect(toCny1dp(43500, rate)).toBe(1848.7);
  });

  it("returns 0 for an invalid rate instead of a made-up conversion", () => {
    expect(capJpyFromCny(2000, 0)).toBe(0);
    expect(capJpyFromCny(2000, Number.NaN)).toBe(0);
    expect(toCny(1000, 0)).toBe(0);
    expect(bandJpyFromCny(1800, 1900, -1)).toEqual({ minJpy: 0, maxJpy: 0 });
  });
});
