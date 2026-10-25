import React, { type ReactNode } from "react";

export type EmptyStateArt =
  | "check"
  | "box"
  | "search"
  | "chat"
  | "tag"
  | "chart"
  | "link"
  | "receipt";

/**
 * Line illustration for empty states, drawn in the site's icon language
 * (24-grid, 1.5 stroke, round caps). One soft disc behind a single motif
 * so every workspace's empty state reads as the same family.
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
      {art === "box" && (
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
      <EmptyStateGlyph art={art} />
      <p className="empty-state-title">{title}</p>
      {description ? (
        <p className="empty-state-description">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
