import { StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** 5-star display for an aggregate rating; grey when null. Server-safe. */
export function RatingStars({
  avg,
  count,
  className,
}: {
  avg: number | null;
  count?: number;
  className?: string;
}) {
  const t = useTranslations("storefront");
  const filled = Math.round(avg ?? 0);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        role="img"
        aria-label={t("ratingOutOf", { rating: avg == null ? "–" : avg.toFixed(1) })}
        className="inline-flex"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <StarIcon
            key={n}
            className={cn(
              "size-3.5",
              n <= filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
          />
        ))}
      </span>
      {count != null && (
        <span className="text-muted-foreground text-xs">
          {avg == null ? t("noReviews") : `${avg.toFixed(1)} (${count})`}
        </span>
      )}
    </span>
  );
}
