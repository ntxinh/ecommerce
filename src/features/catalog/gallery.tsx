"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Img = { id: string; url: string; alt: string };

/** Main image + thumbnail strip. No images → caller should pass nothing and
 *  the main area renders a placeholder. */
export function Gallery({ images, fallbackAlt }: { images: Img[]; fallbackAlt: string }) {
  const t = useTranslations("storefront");
  const [current, setCurrent] = useState(0);
  const img = images[current];
  return (
    <div className="space-y-2">
      <div className="aspect-square w-full overflow-hidden rounded-md bg-muted">
        {img ? (
          <img src={img.url} alt={img.alt || fallbackAlt} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground text-sm">
            {fallbackAlt}
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((im, i) => (
            <button
              key={im.id}
              type="button"
              onClick={() => setCurrent(i)}
              aria-label={t("imageN", { n: i + 1 })}
              className={cn(
                "size-16 shrink-0 overflow-hidden rounded-md border-2",
                i === current ? "border-primary" : "border-transparent",
              )}
            >
              <img src={im.url} alt={im.alt || fallbackAlt} className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
