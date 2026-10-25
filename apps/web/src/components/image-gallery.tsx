"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./image-gallery.module.css";
import { ITEM_PLACEHOLDER_SRC } from "./item-image";

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

function ImagePlaceholder({ label }: { label: string }) {
  return (
    <div className="pointer-events-none grid h-full place-items-center bg-paper text-ink/60">
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden="true"
          className="block aspect-square w-20 rounded-2xl bg-cover bg-center"
          style={{ backgroundImage: `url(${ITEM_PLACEHOLDER_SRC})` }}
        />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
    </div>
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
  quietControls = false,
  showThumbnails = false,
  onSurfaceClick,
}: {
  images: GalleryImage[];
  alt: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  /** Soften chevrons / chrome for decision cards (platform + count live outside). */
  quietControls?: boolean;
  showThumbnails?: boolean;
  /** Optional detail action for the image surface. Gallery controls stay above it. */
  onSurfaceClick?: () => void;
}) {
  const orderedImages = useMemo(
    () => [...images].sort((a, b) => a.position - b.position),
    [images],
  );
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [loadedUrls, setLoadedUrls] = useState<string[]>([]);
  const [lastLoadedImage, setLastLoadedImage] = useState<GalleryImage | null>(null);
  const reduceMotion = useReducedMotion();
  const imageRef = useRef<HTMLImageElement>(null);
  const imageAnimationRef = useRef<Animation | null>(null);
  const directionRef = useRef<-1 | 1>(1);
  const pointerMotionRef = useRef(false);
  const previousVisibleUrlRef = useRef<string | null>(null);
  const availableImages = useMemo(
    () => orderedImages.filter((image) => !failedUrls.includes(image.url)),
    [failedUrls, orderedImages],
  );
  const count = availableImages.length;

  useEffect(() => {
    const urls = new Set(orderedImages.map((image) => image.url));
    setFailedUrls((current) => current.filter((url) => urls.has(url)));
    setLoadedUrls((current) => current.filter((url) => urls.has(url)));
    setLastLoadedImage((current) =>
      current && urls.has(current.url) ? current : null,
    );
  }, [orderedImages]);

  // Keep the selected photo stable when live item updates insert/reorder images.
  const index = Math.max(
    0,
    availableImages.findIndex((image) => image.url === selectedUrl),
  );
  const current = availableImages[index];
  const currentLoaded = Boolean(current && loadedUrls.includes(current.url));
  const retainedImage =
    !currentLoaded &&
    lastLoadedImage &&
    availableImages.some((image) => image.url === lastLoadedImage.url)
      ? lastLoadedImage
      : null;
  useLayoutEffect(() => {
    if (!currentLoaded || !current) return;
    const node = imageRef.current;
    const previous = previousVisibleUrlRef.current;
    previousVisibleUrlRef.current = current.url;
    imageAnimationRef.current?.cancel();
    imageAnimationRef.current = null;
    if (!node || !previous || !availableImages.some(image => image.url === previous) || previous === current.url || reduceMotion || !pointerMotionRef.current || typeof node.animate !== "function") return;
    const animation = node.animate([
      { opacity: .62, transform: `translateX(${directionRef.current * 24}px) scale(1.015)` },
      { opacity: 1, transform: "translateX(0px) scale(1)" },
    ], { duration: motionTokens.duration.sheet * 1000, easing: "cubic-bezier(.23,1,.32,1)", fill: "none" });
    imageAnimationRef.current = animation;
    return () => { animation.cancel(); };
  }, [current?.url, currentLoaded, reduceMotion]);
  const move = (direction: -1 | 1) => {
    if (count < 2) return;
    directionRef.current = direction;
    setSelectedUrl((selected) => {
      const currentIndex = Math.max(
        0,
        availableImages.findIndex((image) => image.url === selected),
      );
      return availableImages[(currentIndex + direction + count) % count].url;
    });
  };
  const onGalleryKeyDown = (event: React.KeyboardEvent) => {
    pointerMotionRef.current = false;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (count < 2) return;
      event.preventDefault();
      event.stopPropagation();
      move(event.key === "ArrowLeft" ? -1 : 1);
    } else if (
      event.currentTarget instanceof HTMLButtonElement &&
      (event.key === "Enter" || event.key === " ")
    ) {
      // Preserve native button activation without firing a containing card.
      event.stopPropagation();
    }
  };

  return (
    <div
      className={`${styles.gallery} relative overflow-hidden ${className}`}
      data-quiet={quietControls || undefined}
      data-loading={Boolean(current && !currentLoaded) || undefined}
      data-thumbnails={showThumbnails && count > 1 || undefined}
      data-pointer-motion="false"
      onPointerDownCapture={(event) => { pointerMotionRef.current = true; event.currentTarget.dataset.pointerMotion = "true"; }}
      onKeyDownCapture={(event) => { pointerMotionRef.current = false; event.currentTarget.dataset.pointerMotion = "false"; }}
      role="group"
      aria-label={`商品图片：${alt}`}
      aria-roledescription="图片轮播"
      tabIndex={!onSurfaceClick && count > 1 ? 0 : undefined}
      onKeyDown={onGalleryKeyDown}
    >
      {onSurfaceClick && (
        <button
          type="button"
          aria-label={`打开商品：${alt}`}
          onPointerDown={stopGalleryControlEvent}
          onKeyDown={onGalleryKeyDown}
          onClick={(event) => {
            event.stopPropagation();
            onSurfaceClick();
          }}
          className={`${styles.surfaceAction} absolute inset-0 z-0 cursor-zoom-in`}
        />
      )}
      {current ? (
        <>
          {!currentLoaded && !retainedImage && (
            <div className="pointer-events-none absolute inset-0">
              <ImagePlaceholder label="正在加载图片" />
            </div>
          )}
          {retainedImage && (
            <img
              src={retainedImage.url}
              alt=""
              aria-hidden="true"
              draggable={false}
              className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${imageClassName}`}
            />
          )}
          <img
            key={current.url}
            ref={imageRef}
            src={current.url}
            alt={alt}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => {
              setLoadedUrls((loaded) =>
                loaded.includes(current.url)
                  ? loaded
                  : [...loaded, current.url],
              );
              setLastLoadedImage(current);
            }}
            onError={() => {
              setFailedUrls((failed) =>
                failed.includes(current.url)
                  ? failed
                  : [...failed, current.url],
              );
            }}
            className={`pointer-events-none relative z-10 h-full w-full object-cover ${imageClassName}`}
            style={{ opacity: currentLoaded ? undefined : 0 }}
          />
        </>
      ) : (
        <div className={`pointer-events-none h-full ${fallbackClassName}`}>
          <ImagePlaceholder label="图片暂不可用" />
        </div>
      )}
      {count > 1 && (
        <>
          <button
            type="button"
            data-gallery-control="previous"
            data-card-interactive="gallery"
            aria-label="查看上一张商品图片"
            title="上一张"
            onMouseDown={stopGalleryControlEvent}
            onTouchStart={stopGalleryControlEvent}
            onPointerDown={stopGalleryControlEvent}
            onPointerUp={stopGalleryControlEvent}
            onKeyDown={onGalleryKeyDown}
            onClick={(event) => {
              stopGalleryControlEvent(event);
              move(-1);
            }}
            className={`${styles.control} ${styles.previous} image-gallery-control`}
          >
            <span className={`${styles.controlSurface} image-gallery-control-surface`}>
              <ChevronIcon direction="left" />
            </span>
          </button>
          <button
            type="button"
            data-gallery-control="next"
            data-card-interactive="gallery"
            aria-label="查看下一张商品图片"
            title="下一张"
            onMouseDown={stopGalleryControlEvent}
            onTouchStart={stopGalleryControlEvent}
            onPointerDown={stopGalleryControlEvent}
            onPointerUp={stopGalleryControlEvent}
            onKeyDown={onGalleryKeyDown}
            onClick={(event) => {
              stopGalleryControlEvent(event);
              move(1);
            }}
            className={`${styles.control} ${styles.next} image-gallery-control`}
          >
            <span className={`${styles.controlSurface} image-gallery-control-surface`}>
              <ChevronIcon direction="right" />
            </span>
          </button>
          <span className={`${styles.counter} image-gallery-counter`} aria-hidden="true">
            {index + 1}<span className={styles.counterDivider}>/</span>{count}
          </span>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            第 {index + 1} 张，共 {count} 张{!currentLoaded ? "，正在加载" : ""}
          </span>
        </>
      )}
      {showThumbnails && count > 1 && <div className={styles.thumbnails} aria-label="选择商品图片">
        {availableImages.map((image, imageIndex) => <button type="button" key={image.url}
          data-card-interactive="gallery" aria-label={`选择第 ${imageIndex + 1} 张商品图片`} aria-pressed={imageIndex === index}
          onPointerDown={stopGalleryControlEvent} onKeyDown={onGalleryKeyDown}
          onClick={(event) => { event.stopPropagation(); directionRef.current = imageIndex >= index ? 1 : -1; setSelectedUrl(image.url); event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" }); }}>
          <img src={image.url} alt="" loading="lazy" draggable={false} />
        </button>)}
      </div>}
    </div>
  );
}
