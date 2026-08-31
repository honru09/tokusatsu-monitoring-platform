"use client";

import React, { useEffect, useMemo, useState } from "react";

type GalleryImage = { url: string; position: number };

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}

function stopGalleryControlEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

export function ImageGallery({
  images,
  alt,
  className = "",
  imageClassName = "",
  fallbackClassName = "",
}: {
  images: GalleryImage[];
  alt: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const orderedImages = useMemo(
    () => [...images].sort((a, b) => a.position - b.position),
    [images],
  );
  const [index, setIndex] = useState(0);
  const count = orderedImages.length;

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, count - 1)));
  }, [count]);

  const current = orderedImages[index];
  const move = (direction: -1 | 1) => {
    if (count < 2) return;
    setIndex((currentIndex) => (currentIndex + direction + count) % count);
  };

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {current ? (
        <img
          src={current.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`h-full w-full object-cover ${imageClassName}`}
        />
      ) : (
        <div
          className={`grid h-full place-items-center bg-ink font-heading text-5xl font-black text-lime/80 ${fallbackClassName}`}
        >
          特
        </div>
      )}
      {count > 1 && (
        <>
          <button
            type="button"
            data-gallery-control="previous"
            aria-label="查看上一张商品图片"
            title="上一张"
            onPointerDown={stopGalleryControlEvent}
            onPointerUp={stopGalleryControlEvent}
            onKeyDown={stopGalleryControlEvent}
            onClick={(event) => {
              stopGalleryControlEvent(event);
              move(-1);
            }}
            className="image-gallery-control absolute left-0.5 top-1/2 z-20 grid h-12 w-12 -translate-y-1/2 touch-manipulation place-items-center text-white outline-none focus-visible:ring-4 focus-visible:ring-white/70 sm:left-1"
          >
            <span className="image-gallery-control-surface grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-ink/70 shadow-lg backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-ink/90 active:scale-95 motion-reduce:transition-none">
              <ChevronIcon direction="left" />
            </span>
          </button>
          <button
            type="button"
            data-gallery-control="next"
            aria-label="查看下一张商品图片"
            title="下一张"
            onPointerDown={stopGalleryControlEvent}
            onPointerUp={stopGalleryControlEvent}
            onKeyDown={stopGalleryControlEvent}
            onClick={(event) => {
              stopGalleryControlEvent(event);
              move(1);
            }}
            className="image-gallery-control absolute right-0.5 top-1/2 z-20 grid h-12 w-12 -translate-y-1/2 touch-manipulation place-items-center text-white outline-none focus-visible:ring-4 focus-visible:ring-white/70 sm:right-1"
          >
            <span className="image-gallery-control-surface grid h-11 w-11 place-items-center rounded-full border border-white/25 bg-ink/70 shadow-lg backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-ink/90 active:scale-95 motion-reduce:transition-none">
              <ChevronIcon direction="right" />
            </span>
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {orderedImages.slice(0, 12).map((image, dotIndex) => (
              <span
                key={`${image.url}-${dotIndex}`}
                className={`h-1.5 w-1.5 rounded-full ${dotIndex === index ? "bg-white" : "bg-white/45"}`}
              />
            ))}
            {count > 12 && (
              <span className="ml-1 rounded bg-ink/65 px-1 text-[9px] font-bold text-white">
                +{count - 12}
              </span>
            )}
          </div>
          <span className="pointer-events-none absolute right-2 top-2 rounded bg-ink/70 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
            {index + 1}/{count}
          </span>
        </>
      )}
    </div>
  );
}
