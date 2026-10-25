"use client";

import React, { useState } from "react";

/** Picture-frame glyph used when an item image is missing or fails. */
export function ImageGlyph({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5.5 17 4-4 3 3 2.5-2.5 3.5 3.5" />
    </svg>
  );
}

/** Placeholder treatment shared by every item surface with no photo. */
export const ITEM_PLACEHOLDER_SRC = "/illustrations/item-placeholder.webp";

/** Wide placeholder for the detail gallery, whose frame is landscape. */
export const DETAIL_PLACEHOLDER_SRC =
  "/illustrations/detail-placeholder-wide.webp";

/**
 * The designed missing-photo tile: pale blue ground with the framed
 * helmet mark. Rendered as an image so catalog cards, chat cards,
 * shipping rows and purchase rows all show the same treatment; if the
 * asset itself fails to load it degrades to the picture-frame glyph.
 */
export function ItemPlaceholderArt() {
  const [failed, setFailed] = useState(false);
  if (failed) return <ImageGlyph />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ITEM_PLACEHOLDER_SRC}
      alt=""
      width={480}
      height={480}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}

/**
 * Item thumbnail that never shows a broken-image icon: a missing URL or
 * a load error degrades to the designed placeholder tile. The caller owns
 * sizing through className (the frame fills its box).
 */
export function SafeItemImage({
  src,
  alt,
  className = "",
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={`safe-item-image-placeholder ${className}`}
        aria-hidden="true"
      >
        <ItemPlaceholderArt />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
