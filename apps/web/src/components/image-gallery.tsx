"use client";

import { useEffect, useMemo, useState } from "react";

type GalleryImage = { url: string; position: number };

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
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
            aria-label="查看上一张商品图片"
            title="上一张"
            onClick={(event) => {
              event.stopPropagation();
              move(-1);
            }}
            className="absolute left-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-ink/70 text-white backdrop-blur transition-colors hover:bg-ink"
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            aria-label="查看下一张商品图片"
            title="下一张"
            onClick={(event) => {
              event.stopPropagation();
              move(1);
            }}
            className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-ink/70 text-white backdrop-blur transition-colors hover:bg-ink"
          >
            <ChevronIcon direction="right" />
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
