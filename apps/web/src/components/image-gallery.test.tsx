// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGallery } from "./image-gallery";

describe("ImageGallery", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("keeps gallery pointer and click events from opening the parent card", () => {
    const parentClick = vi.fn();
    const parentPointerDown = vi.fn();

    act(() => {
      root.render(
        <div onClick={parentClick} onPointerDown={parentPointerDown}>
          <ImageGallery
            images={[
              { url: "https://example.com/1.jpg", position: 0 },
              { url: "https://example.com/2.jpg", position: 1 },
            ]}
            alt="测试商品"
          />
        </div>,
      );
    });

    const next = host.querySelector<HTMLButtonElement>(
      '[data-gallery-control="next"]',
    );
    expect(next).not.toBeNull();
    expect(next?.className).toContain("image-gallery-control");
    const initialControlClass = next?.className;
    expect(next?.dataset.cardInteractive).toBe("gallery");

    act(() => {
      next?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(parentPointerDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(host.textContent).toContain("2/2");
    expect(next?.className).toBe(initialControlClass);
  });

  it("moves to the next usable image when a marketplace image fails", () => {
    act(() => {
      root.render(
        <ImageGallery
          images={[
            { url: "https://example.com/broken.jpg", position: 0 },
            { url: "https://example.com/usable.jpg", position: 1 },
          ]}
          alt="测试商品"
        />,
      );
    });

    const firstImage = host.querySelector<HTMLImageElement>("img");
    expect(firstImage?.src).toContain("broken.jpg");

    act(() => firstImage?.dispatchEvent(new Event("error")));

    expect(host.querySelector<HTMLImageElement>("img")?.src).toContain(
      "usable.jpg",
    );
    expect(host.querySelector('[data-gallery-control="next"]')).toBeNull();
  });

  it("keeps the image surface clickable without stealing gallery controls", () => {
    const onSurfaceClick = vi.fn();

    act(() => {
      root.render(
        <ImageGallery
          images={[
            { url: "https://example.com/1.jpg", position: 0 },
            { url: "https://example.com/2.jpg", position: 1 },
          ]}
          alt="测试商品"
          onSurfaceClick={onSurfaceClick}
        />,
      );
    });

    const surface = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开商品：测试商品"]',
    );
    expect(surface).not.toBeNull();
    expect(surface?.className).toContain("z-0");

    act(() => surface?.click());
    expect(onSurfaceClick).toHaveBeenCalledTimes(1);

    const next = host.querySelector<HTMLButtonElement>(
      '[data-gallery-control="next"]',
    );
    act(() => {
      next?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSurfaceClick).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("2/2");
  });

  it("shows a neutral fallback when every stored image is unavailable", () => {
    act(() => {
      root.render(
        <ImageGallery
          images={[{ url: "https://example.com/broken.jpg", position: 0 }]}
          alt="测试商品"
        />,
      );
    });

    act(() =>
      host
        .querySelector<HTMLImageElement>("img")
        ?.dispatchEvent(new Event("error")),
    );

    expect(host.textContent).toContain("图片暂不可用");
    expect(host.querySelector("img")).toBeNull();
  });

  it("uses the wide placeholder tile for the detail empty state when asked", () => {
    act(() => {
      root.render(
        <ImageGallery images={[]} alt="测试商品" wideEmptyPlaceholder />,
      );
    });

    expect(host.textContent).toContain("图片暂不可用");
    const tile = host.querySelector<HTMLImageElement>(
      'img[src="/illustrations/detail-placeholder-wide.webp"]',
    );
    expect(tile).not.toBeNull();
    expect(tile?.getAttribute("width")).toBe("960");
    expect(tile?.getAttribute("height")).toBe("640");
    expect(tile?.className).toContain("aspect-[3/2]");
  });

  it("keeps the square tile for the default empty state", () => {
    act(() => {
      root.render(<ImageGallery images={[]} alt="测试商品" />);
    });

    expect(host.textContent).toContain("图片暂不可用");
    expect(
      host.querySelector('img[src="/illustrations/detail-placeholder-wide.webp"]'),
    ).toBeNull();
  });

  it("preserves the last loaded photo while the requested photo loads", () => {
    act(() => {
      root.render(
        <ImageGallery
          images={[
            { url: "https://example.com/1.jpg", position: 0 },
            { url: "https://example.com/2.jpg", position: 1 },
          ]}
          alt="测试商品"
          quietControls
        />,
      );
    });
    act(() => host.querySelector("img")?.dispatchEvent(new Event("load")));
    act(() => host.querySelector<HTMLButtonElement>('[data-gallery-control="next"]')?.click());

    expect(host.querySelector<HTMLImageElement>('img[aria-hidden="true"]')?.src).toContain("1.jpg");
    expect(host.querySelector('[role="group"]')?.getAttribute("data-loading")).toBe("true");
    expect(host.textContent).not.toContain("正在加载图片");
    expect(host.textContent).toContain("2/2");

    act(() => host.querySelector('img[alt="测试商品"]')?.dispatchEvent(new Event("load")));
    expect(host.querySelector('img[aria-hidden="true"]')).toBeNull();
    expect(host.querySelector('[role="group"]')?.hasAttribute("data-loading")).toBe(false);
    expect(host.querySelector<HTMLImageElement>("img")?.src).toContain("2.jpg");
  });

  it("supports repeated keyboard navigation without activating a containing card", () => {
    const parentKeyDown = vi.fn();
    const parentClick = vi.fn();
    act(() => {
      root.render(
        <div onKeyDown={parentKeyDown} onClick={parentClick}>
          <ImageGallery
            images={[
              { url: "https://example.com/1.jpg", position: 0 },
              { url: "https://example.com/2.jpg", position: 1 },
              { url: "https://example.com/3.jpg", position: 2 },
            ]}
            alt="测试商品"
          />
        </div>,
      );
    });
    const gallery = host.querySelector<HTMLElement>('[role="group"]');
    expect(gallery?.tabIndex).toBe(0);
    const arrow = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    act(() => gallery?.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("2/3");

    act(() => {
      gallery?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      gallery?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(host.textContent).toContain("1/3");
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();

    act(() => host.querySelector('[data-gallery-control="next"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });

  it("does not double-handle keyboard arrows on gallery buttons", () => {
    act(() => {
      root.render(
        <ImageGallery
          images={[
            { url: "https://example.com/1.jpg", position: 0 },
            { url: "https://example.com/2.jpg", position: 1 },
            { url: "https://example.com/3.jpg", position: 2 },
          ]}
          alt="测试商品"
          onSurfaceClick={vi.fn()}
        />,
      );
    });
    act(() => host.querySelector('[data-gallery-control="next"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.textContent).toContain("2/3");
    act(() => host.querySelector('button[aria-label="打开商品：测试商品"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(host.textContent).toContain("1/3");
  });

  it("preserves the selected photo when live updates insert another photo before it", () => {
    const first = { url: "https://example.com/1.jpg", position: 0 };
    const second = { url: "https://example.com/2.jpg", position: 1 };
    act(() => root.render(<ImageGallery images={[first, second]} alt="测试商品" />));
    act(() => host.querySelector<HTMLButtonElement>('[data-gallery-control="next"]')?.click());
    act(() => root.render(<ImageGallery images={[{ url: "https://example.com/new.jpg", position: -1 }, first, second]} alt="测试商品" />));
    expect(host.querySelector<HTMLImageElement>('img[alt="测试商品"]')?.src).toContain("2.jpg");
    expect(host.textContent).toContain("3/3");
  });

  it("uses detail thumbnails without leaking actions into a containing card", () => {
    const cardAction = vi.fn();
    act(() => root.render(<div onClick={cardAction}><ImageGallery showThumbnails images={[{url:"https://example.com/1.jpg",position:0},{url:"https://example.com/2.jpg",position:1}]} alt="测试商品" /></div>));
    const thumbnail = host.querySelector<HTMLButtonElement>('[aria-label="选择第 2 张商品图片"]')!;
    act(() => thumbnail.click());
    expect(thumbnail.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLImageElement>('img[alt="测试商品"]')?.src).toContain("2.jpg");
    expect(cardAction).not.toHaveBeenCalled();
  });

  it("keeps a visible current/total count for galleries longer than twelve images", () => {
    act(() => root.render(
      <ImageGallery
        images={Array.from({ length: 15 }, (_, index) => ({ url: `https://example.com/${index}.jpg`, position: index }))}
        alt="测试商品"
        quietControls
      />,
    ));
    act(() => host.querySelector<HTMLButtonElement>('[data-gallery-control="previous"]')?.click());
    expect(host.textContent).toContain("15/15");
    expect(host.querySelector('[role="status"]')?.textContent).toContain("第 15 张，共 15 张");
  });

  it("does not expose old retained images when the component receives another product", () => {
    act(() => root.render(<ImageGallery images={[{ url: "https://example.com/old.jpg", position: 0 }]} alt="旧商品" />));
    act(() => host.querySelector("img")?.dispatchEvent(new Event("load")));
    act(() => root.render(<ImageGallery images={[{ url: "https://example.com/new.jpg", position: 0 }]} alt="新商品" />));
    expect(host.querySelector('img[aria-hidden="true"]')).toBeNull();
    expect(host.querySelector<HTMLImageElement>("img")?.src).toContain("new.jpg");
    expect(host.textContent).toContain("正在加载图片");
  });

  it("isolates direct surface clicks from the containing card action", () => {
    const parentClick = vi.fn();
    const surfaceClick = vi.fn();
    act(() => root.render(
      <div onClick={parentClick}>
        <ImageGallery images={[]} alt="测试商品" onSurfaceClick={surfaceClick} />
      </div>,
    ));
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="打开商品：测试商品"]')?.click());
    expect(surfaceClick).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
    expect(host.querySelector('[data-gallery-control="next"]')).toBeNull();
  });
});
