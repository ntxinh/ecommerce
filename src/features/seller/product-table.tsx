import { Badge } from "@/components/ui/badge";
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
import { ProductRowActions } from "./product-row-actions";

const STATUS_VARIANT = {
  DRAFT: "secondary",
  ACTIVE: "default",
  ARCHIVED: "outline",
} as const;

type T = (key: string) => string;

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
          <TableHead className="text-right">{t("colAvailable")}</TableHead>
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
            <TableCell className="text-right">{p.available}</TableCell>
            <TableCell className="text-right">
              {p.minPriceVnd == null ? "—" : formatVnd(p.minPriceVnd)}
            </TableCell>
            <TableCell>
              <ProductRowActions product={p} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
