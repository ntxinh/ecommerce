"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRouter } from "@/i18n/navigation";
import { setSettingAction } from "./actions";

const ERROR_KEYS: Record<string, true> = {
  UNAUTHORIZED: true,
  FORBIDDEN: true,
  INVALID_INPUT: true,
};

function SettingRow({ k, value }: { k: string; value: string }) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const formId = `set-${k}`;

  return (
    <TableRow>
      <TableCell className="font-mono text-xs font-medium">{k}</TableCell>
      <TableCell>
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set("key", k);
            start(async () => {
              const res = await setSettingAction(fd);
              if (res.ok) {
                toast.success(t("settingsSaved"));
                router.refresh();
              } else {
                toast.error(
                  t(ERROR_KEYS[res.error ?? ""] ? `errors.${res.error}` : "errors.INVALID_INPUT"),
                );
              }
            });
          }}
        />
        <Input form={formId} name="value" defaultValue={value} disabled={pending} aria-label={k} />
      </TableCell>
      <TableCell className="text-right">
        <Button type="submit" form={formId} variant="ghost" size="sm" disabled={pending}>
          {t("save")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** One editable row per whitelisted key; value is JSON text (validated server-side). */
export function SettingsForm({
  keys,
  values,
}: {
  keys: string[];
  values: Record<string, unknown>;
}) {
  const t = useTranslations("admin");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colKey")}</TableHead>
          <TableHead>{t("colValue")}</TableHead>
          <TableHead className="text-right">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <SettingRow key={k} k={k} value={k in values ? JSON.stringify(values[k]) : ""} />
        ))}
      </TableBody>
    </Table>
  );
}
