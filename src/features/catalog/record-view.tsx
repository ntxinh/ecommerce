"use client";

import { useEffect } from "react";
import { useRecentlyViewed } from "@/features/catalog/use-recently-viewed";

/** Records `productId` in the recently-viewed store on mount; renders nothing. */
export function RecordView({ productId }: { productId: string }) {
  const record = useRecentlyViewed((s) => s.record);
  useEffect(() => record(productId), [record, productId]);
  return null;
}
