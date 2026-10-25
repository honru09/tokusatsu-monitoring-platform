"use client";

import React, { useState, type ReactNode } from "react";

export type EmptyStateArt =
  | "check"
  | "box"
  | "search"
  | "chat"
  | "tag"
  | "chart"
  | "link"
  | "receipt"
  | "favorites"
  | "shipping";

/**
 * Illustration for the empty states that have one. One family: flat,
 * pale blue ground, ink-navy line work, a single blue accent. Art keys
 * without an entry keep the line glyph below.
 */
const EMPTY_STATE_ARTWORK: Partial<Record<EmptyStateArt, string>> = {
  check: "/illustrations/empty-todo.webp",
  search: "/illustrations/empty-catalog.webp",
  chat: "/illustrations/empty-shares.webp",
  receipt: "/illustrations/empty-purchases.webp",
  box: "/illustrations/empty-inventory.webp",
  shipping: "/illustrations/empty-shipping.webp",
  favorites: "/illustrations/empty-favorites.webp",
};

/**
 * Line illustration for empty states, drawn in the site's icon language
 * (24-grid, 1.5 stroke, round caps). One soft disc behind a single motif
 * so every workspace's empty state reads as the same family. Also the
 * fallback when an artwork image fails to load.
 */
export function EmptyStateGlyph({ art }: { art: EmptyStateArt }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="empty-state-glyph"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="24" cy="24" r="21" className="empty-state-glyph-disc" />
      {art === "check" && <path d="m16.5 24.5 5 5 10-11" />}
      {(art === "box" || art === "shipping") && (
        <>
          <path d="M15 19.5 24 15l9 4.5v9L24 33l-9-4.5v-9Z" />
          <path d="m15 19.5 9 4.5 9-4.5M24 24v9" />
        </>
      )}
      {art === "search" && (
        <>
          <circle cx="22" cy="22" r="6.5" />
          <path d="m27 27 5.5 5.5" />
        </>
      )}
      {art === "chat" && (
        <>
          <path d="M14 16.5A2.5 2.5 0 0 1 16.5 14h15A2.5 2.5 0 0 1 34 16.5v8a2.5 2.5 0 0 1-2.5 2.5H24l-5.5 4.5v-4.5h-2A2.5 2.5 0 0 1 14 24.5v-8Z" />
          <path d="M19 20.5h10" />
        </>
      )}
      {art === "tag" && (
        <>
          <path d="M15 15h8l10 10-8 8-10-10v-8Z" />
          <circle cx="19.5" cy="19.5" r="1.6" />
        </>
      )}
      {art === "favorites" && (
        <path d="M24 32.5S15.5 27.4 15.5 20.9A4.9 4.9 0 0 1 24 17a4.9 4.9 0 0 1 8.5 3.9c0 6.5-8.5 11.6-8.5 11.6Z" />
      )}
      {art === "chart" && (
        <>
          <path d="M15 33.5v-19" />
          <path d="M15 33.5h18" />
          <path d="m19 27 4.5-5 3.5 3 5-6" />
        </>
      )}
      {art === "link" && (
        <>
          <path d="M20.5 27.5a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1.5 1.5" />
          <path d="M27.5 20.5a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1.5-1.5" />
        </>
      )}
      {art === "receipt" && (
        <>
          <path d="M17 13.5h14v21l-2.3-1.7-2.4 1.7-2.3-1.7-2.3 1.7-2.4-1.7L17 34.5v-21Z" />
          <path d="M20.5 20h7M20.5 24.5h7" />
        </>
      )}
    </svg>
  );
}

/**
 * Artwork slot above the empty-state copy. Fixed square ratio so the
 * layout does not move while the image loads; an art key without an
 * illustration, or an image that fails to load, falls back to the
 * line glyph.
 */
function EmptyStateArtwork({
  art,
  compact,
}: {
  art: EmptyStateArt;
  compact: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = EMPTY_STATE_ARTWORK[art];
  if (!src || failed) return <EmptyStateGlyph art={art} />;
  return (
    <span
      aria-hidden="true"
      className={`block aspect-square shrink-0 overflow-hidden rounded-[24%] ${
        compact ? "w-16" : "w-28"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={468}
        height={468}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

/**
 * The one empty-state block for every workspace: illustration, one line
 * of copy, optional supporting line and one optional action. Keeps the
 * caller's surface chrome (border/background) when `bare` is not set by
 * rendering chrome-less and letting the parent frame it.
 */
export function EmptyState({
  art,
  title,
  description,
  children,
  compact = false,
}: {
  art: EmptyStateArt;
  title: string;
  description?: string;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`empty-state${compact ? " empty-state-compact" : ""}`}
      role="status"
    >
      <EmptyStateArtwork art={art} compact={compact} />
      <p className="empty-state-title">{title}</p>
      {description ? (
        <p className="empty-state-description">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
