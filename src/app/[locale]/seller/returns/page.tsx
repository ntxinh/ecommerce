export const instant = false;

import { inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { ReturnQueue } from "@/features/returns/queue";
import { loadReturnRows, toQueueRows } from "@/features/returns/queue-data";
import { Link, redirect } from "@/i18n/navigation";
import { AuthError } from "@/server/api/errors";
import { requireSeller } from "@/server/auth/actor";
import type { Actor } from "@/server/auth/permissions";
import { getDb } from "@/server/db/client";
import { shops } from "@/server/db/schema";
import { listReturnRequests } from "@/server/modules/orders/returns";

export default async function SellerReturnsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ shop?: string; cursor?: string; status?: string }>;
}) {
  const { locale } = await params;
  const { shop, cursor, status } = await searchParams;
  let actor: Actor;
  try {
    actor = await requireSeller();
  } catch (e) {
    if (e instanceof AuthError && e.status === 403) redirect({ href: "/", locale });
    if (e instanceof AuthError) redirect({ href: "/login", locale });
    throw e;
  }

  const shopIds = actor.memberships.map((m) => m.shopId);
  if (shopIds.length === 0) redirect({ href: "/seller", locale });
  const db = getDb();
  const myShops = db.select().from(shops).where(inArray(shops.id, shopIds)).all();
  const shopId = shop && shopIds.includes(shop) ? shop : shopIds[0];
  const { items, nextCursor } = listReturnRequests(db, actor, {
    shopId,
    status: status === "ALL" ? undefined : "PENDING",
    cursor,
  });
  const rows = toQueueRows(
    items,
    loadReturnRows(
      db,
      items.map((r) => r.id),
    ),
    locale,
    (s) => s === "PENDING",
  );

  const t = await getTranslations({ locale, namespace: "returns" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("queueTitle")}</h1>
      <nav className="flex gap-3 text-sm">
        {myShops.length > 1
          ? myShops.map((s) => (
              <Link
                key={s.id}
                href={`/seller/returns?shop=${s.id}${status === "ALL" ? "&status=ALL" : ""}`}
                className={s.id === shopId ? "font-semibold underline" : "text-muted-foreground"}
              >
                {s.name}
              </Link>
            ))
          : null}
        <Link
          href={`/seller/returns?shop=${shopId}`}
          className={status === "ALL" ? "text-muted-foreground" : "font-semibold underline"}
        >
          {t("filterPending")}
        </Link>
        <Link
          href={`/seller/returns?shop=${shopId}&status=ALL`}
          className={status === "ALL" ? "font-semibold underline" : "text-muted-foreground"}
        >
          {t("filterAll")}
        </Link>
      </nav>
      <ReturnQueue rows={rows} empty={t("queueEmpty")} />
      {nextCursor ? (
        <Link
          href={{
            pathname: "/seller/returns",
            query: { shop: shopId, status: status ?? "PENDING", cursor: nextCursor },
          }}
          className="text-sm underline underline-offset-2"
        >
          {t("nextPage")}
        </Link>
      ) : null}
    </div>
  );
}
