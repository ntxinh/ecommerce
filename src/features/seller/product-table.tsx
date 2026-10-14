import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { formatVnd } from "@/lib/format";
import type { SellerProductRow } from "@/server/modules/catalog/manage";
import { duplicateProductAction, setProductStatusAction } from "./actions";

const STATUS_VARIANT = {
  DRAFT: "secondary",
  ACTIVE: "default",
  ARCHIVED: "outline",
} as const;

type T = (key: string) => string;

function statusForm(productId: string, status: "DRAFT" | "ACTIVE" | "ARCHIVED", label: string) {
  return (
    <form key={status} action={setProductStatusAction}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant="ghost" size="sm">
        {label}
      </Button>
    </form>
  );
}

/** Seller product table: status badges + publish/unpublish/archive/duplicate. */
export function ProductTable({
  items,
  t,
  locale,
}: {
  items: SellerProductRow[];
  t: T;
  locale: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("colName")}</TableHead>
          <TableHead>{t("colStatus")}</TableHead>
          <TableHead className="text-right">{t("colVariants")}</TableHead>
          <TableHead className="text-right">{t("colStock")}</TableHead>
          <TableHead className="text-right">{t("colPrice")}</TableHead>
          <TableHead className="text-right">{t("colActions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium">
              <Link href={`/seller/products/${p.id}`} className="hover:underline">
                {locale === "vi" ? p.nameVi : p.nameEn}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[p.status]}>{t(`status.${p.status}`)}</Badge>
            </TableCell>
            <TableCell className="text-right">{p.variantCount}</TableCell>
            <TableCell className="text-right">{p.onHand}</TableCell>
            <TableCell className="text-right">
              {p.minPriceVnd == null ? "—" : formatVnd(p.minPriceVnd)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/seller/products/${p.id}`}>{t("edit")}</Link>
                </Button>
                {p.status === "DRAFT" ? statusForm(p.id, "ACTIVE", t("publish")) : null}
                {p.status === "ACTIVE" ? statusForm(p.id, "DRAFT", t("unpublish")) : null}
                {p.status !== "ARCHIVED" ? statusForm(p.id, "ARCHIVED", t("archive")) : null}
                {p.status === "ARCHIVED" ? statusForm(p.id, "DRAFT", t("restore")) : null}
                <form action={duplicateProductAction}>
                  <input type="hidden" name="productId" value={p.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("duplicate")}
                  </Button>
                </form>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
