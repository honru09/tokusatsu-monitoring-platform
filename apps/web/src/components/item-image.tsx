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

/**
 * Item thumbnail that never shows a broken-image icon: a missing URL or
 * a load error degrades to the designed fog placeholder. The caller owns
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
        <ImageGlyph />
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
