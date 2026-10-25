"use client";

import React, { useState } from "react";

export type WorkspaceHeaderArtKind = "todo" | "catalog" | "chat" | "dashboard";

/**
 * Spot illustration for each primary workspace header. One family with
 * the empty-state art: flat, pale blue ground, ink-navy line work, a
 * single blue accent, no text.
 */
export const WORKSPACE_HEADER_ARTWORK: Record<WorkspaceHeaderArtKind, string> =
  {
    todo: "/illustrations/header-todo.webp",
    catalog: "/illustrations/header-catalog.webp",
    chat: "/illustrations/header-chat.webp",
    dashboard: "/illustrations/header-dashboard.webp",
  };

/**
 * The one header spot slot: 56x56 everywhere, dimensions reserved up
 * front so a header never shifts while the image loads. Purely
 * decorative - the workspace title next to it carries the meaning -
 * and if the asset fails to load the slot just stays empty.
 */
export function WorkspaceHeaderArt({ art }: { art: WorkspaceHeaderArtKind }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      aria-hidden="true"
      data-workspace-header-art={art}
      className="block h-14 w-14 shrink-0 overflow-hidden rounded-2xl"
    >
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={WORKSPACE_HEADER_ARTWORK[art]}
          alt=""
          width={480}
          height={480}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}
