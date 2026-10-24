"use client";

import React, { createContext, useContext } from "react";
import type { ProductCardDensity } from "./product-card-item";

export type { ProductCardDensity };

export const CARD_DENSITY_STORAGE_KEY = "kamen-product-card-density-v1";

export const ProductCardDensityContext =
  createContext<ProductCardDensity>("standard");

export function useProductCardDensity() {
  return useContext(ProductCardDensityContext);
}

export function readStoredCardDensity(): ProductCardDensity {
  try {
    return window.localStorage.getItem(CARD_DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "standard";
  } catch {
    return "standard";
  }
}

export function storeCardDensity(density: ProductCardDensity) {
  try {
    window.localStorage.setItem(CARD_DENSITY_STORAGE_KEY, density);
  } catch {}
}

export function ProductCardDensityToggle({
  density,
  onChange,
}: {
  density: ProductCardDensity;
  onChange: (density: ProductCardDensity) => void;
}) {
  return (
    <div
      className="product-card-density-toggle flex shrink-0 gap-1"
      role="group"
      aria-label="商品卡片密度"
    >
      {(
        [
          ["standard", "标准"],
          ["compact", "紧凑"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={density === value}
          onClick={() => onChange(value)}
          className={`min-h-11 rounded-lg border px-3 text-xs font-black transition-colors ${
            density === value
              ? "border-ink bg-ink text-lime"
              : "border-blue-200 bg-white text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
