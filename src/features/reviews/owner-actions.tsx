"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { deleteReviewAction, updateReviewAction } from "./actions";

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  NOT_FOUND: true,
  INVALID_INPUT: true,
};

/**
 * Inline edit + delete affordance rendered under the actor's own reviews on
 * the product page. Both call the same service guards the API routes use.
 */
export function ReviewOwnerActions({
  review,
}: {
  review: { id: string; rating: number; title: string | null; body: string | null };
}) {
  const t = useTranslations("reviews");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const id = `edit-${review.id}`;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("reviewId", review.id);
    start(async () => {
      const res = await updateReviewAction(fd);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      } else {
        toast.error(
          t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
      }
    });
  };

  const del = () => {
    const fd = new FormData();
    fd.set("reviewId", review.id);
    start(async () => {
      const res = await deleteReviewAction(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });
  };

  if (!editing) {
    return (
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          {t("edit")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={del} disabled={pending}>
          {t("delete")}
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="space-y-1">
        <Label htmlFor={`${id}-rating`}>{t("rating")}</Label>
        <select
          id={`${id}-rating`}
          name="rating"
          required
          defaultValue={String(review.rating)}
          disabled={pending}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={r}>
              {t("stars", { count: r })}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-title`}>{t("titleLabel")}</Label>
        <Input id={`${id}-title`} name="title" maxLength={200} defaultValue={review.title ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-body`}>{t("bodyLabel")}</Label>
        <textarea
          id={`${id}-body`}
          name="body"
          maxLength={5000}
          rows={3}
          defaultValue={review.body ?? ""}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t("save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
