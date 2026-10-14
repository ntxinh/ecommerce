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
import type { AdminCategoryRow } from "@/server/modules/catalog/moderation";
import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "./actions";

const ERROR_KEYS = new Set(["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT"]);

type Action = (fd: FormData) => Promise<{ ok: boolean; error?: string }>;

function useCategoryAction() {
  const t = useTranslations("admin");
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: Action, fd: FormData) => {
    start(async () => {
      const res = await action(fd);
      if (res.ok) router.refresh();
      else
        toast.error(
          t(ERROR_KEYS.has(res.error ?? "") ? `errors.${res.error}` : "errors.INVALID_INPUT"),
        );
    });
  };
  return { run, pending, t };
}

function ParentSelect({
  formId,
  name,
  categories,
  exclude,
  defaultValue,
  t,
}: {
  formId?: string;
  name: string;
  categories: AdminCategoryRow[];
  exclude?: string;
  defaultValue?: string | null;
  t: (k: string) => string;
}) {
  return (
    <select
      form={formId}
      name={name}
      defaultValue={defaultValue ?? ""}
      className="h-9 rounded-md border bg-background px-2 text-sm"
    >
      <option value="">{t("noParent")}</option>
      {categories
        .filter((c) => c.id !== exclude)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.nameEn}
          </option>
        ))}
    </select>
  );
}

function CategoryRow({
  row,
  categories,
}: {
  row: AdminCategoryRow;
  categories: AdminCategoryRow[];
}) {
  const { run, pending, t } = useCategoryAction();
  const formId = `cat-${row.id}`;

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("id", row.id);
    run(updateCategoryAction, fd);
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.slug}</TableCell>
      <TableCell>
        <form id={formId} onSubmit={submit} />
        <Input form={formId} name="nameEn" defaultValue={row.nameEn} disabled={pending} />
      </TableCell>
      <TableCell>
        <Input form={formId} name="nameVi" defaultValue={row.nameVi} disabled={pending} />
      </TableCell>
      <TableCell>
        <ParentSelect
          formId={formId}
          name="parentId"
          categories={categories}
          exclude={row.id}
          defaultValue={row.parentId}
          t={t}
        />
      </TableCell>
      <TableCell>
        <Input
          form={formId}
          name="sortOrder"
          type="number"
          defaultValue={row.sortOrder}
          disabled={pending}
          className="w-20"
        />
      </TableCell>
      <TableCell className="text-right">{row.productCount}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button type="submit" form={formId} variant="ghost" size="sm" disabled={pending}>
            {t("save")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending || row.productCount > 0}
            title={row.productCount > 0 ? t("deleteBlocked") : undefined}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", row.id);
              run(deleteCategoryAction, fd);
            }}
          >
            {t("delete")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Admin category CRUD: inline edits, create form, delete guarded by product count. */
export function CategoryTable({ categories }: { categories: AdminCategoryRow[] }) {
  const { run, pending, t } = useCategoryAction();

  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colSlug")}</TableHead>
            <TableHead>{t("colNameEn")}</TableHead>
            <TableHead>{t("colNameVi")}</TableHead>
            <TableHead>{t("colParent")}</TableHead>
            <TableHead>{t("colSort")}</TableHead>
            <TableHead className="text-right">{t("colProducts")}</TableHead>
            <TableHead className="text-right">{t("colActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((c) => (
            <CategoryRow key={c.id} row={c} categories={categories} />
          ))}
        </TableBody>
      </Table>

      <form
        className="flex flex-wrap items-end gap-2 rounded-md border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          run(createCategoryAction, new FormData(form));
          form.reset();
        }}
      >
        <Input name="slug" placeholder={t("fieldSlug")} required className="w-40" />
        <Input name="nameEn" placeholder={t("colNameEn")} required className="w-48" />
        <Input name="nameVi" placeholder={t("colNameVi")} required className="w-48" />
        <ParentSelect name="parentId" categories={categories} t={t} />
        <Input name="sortOrder" type="number" defaultValue={0} className="w-20" />
        <Button type="submit" disabled={pending}>
          {t("createCategory")}
        </Button>
      </form>
    </div>
  );
}
