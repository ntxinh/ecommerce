"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { createPlatformVoucherAction } from "./actions";

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  INVALID_INPUT: true,
};

const toLocalInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** Create a PLATFORM voucher. Optional numeric fields left blank → no limit. */
export function VoucherForm() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const now = Date.now();

  return (
    <form
      className="grid grid-cols-2 gap-2 rounded-md border p-4 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        start(async () => {
          const res = await createPlatformVoucherAction(new FormData(form));
          if (res.ok) {
            toast.success(t("voucherCreated"));
            form.reset();
            router.refresh();
          } else {
            toast.error(
              t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
            );
          }
        });
      }}
    >
      <Input name="code" placeholder={t("fieldCode")} required />
      <select
        name="kind"
        defaultValue="PERCENT"
        className="h-9 rounded-md border bg-background px-2 text-sm"
      >
        {(["PERCENT", "FIXED", "SHIPPING"] as const).map((k) => (
          <option key={k} value={k}>
            {t(`voucherKind.${k}`)}
          </option>
        ))}
      </select>
      <Input name="value" type="number" min={1} placeholder={t("fieldValue")} required />
      <Input name="minSpendVnd" type="number" min={0} placeholder={t("fieldMinSpend")} />
      <Input name="maxDiscountVnd" type="number" min={1} placeholder={t("fieldMaxDiscount")} />
      <Input
        name="startsAt"
        type="datetime-local"
        aria-label={t("fieldStarts")}
        defaultValue={toLocalInput(now)}
        required
      />
      <Input
        name="endsAt"
        type="datetime-local"
        aria-label={t("fieldEnds")}
        defaultValue={toLocalInput(now + 30 * 86_400_000)}
        required
      />
      <Input name="totalLimit" type="number" min={1} placeholder={t("fieldTotalLimit")} />
      <Input name="perUserLimit" type="number" min={1} placeholder={t("fieldPerUserLimit")} />
      <Button type="submit" disabled={pending} className="col-span-2 md:col-span-1">
        {t("createVoucher")}
      </Button>
    </form>
  );
}
