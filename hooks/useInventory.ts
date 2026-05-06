"use client";
import { useState, useCallback, useEffect } from "react";
import type { SelectedProduct, StoreInfo } from "@/lib/types";

export function useInventory(selectedProducts: SelectedProduct[]) {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Clear map when product list changes so stale markers don't linger
  useEffect(() => {
    setStores([]);
  }, [JSON.stringify(selectedProducts.map((p) => p.pdNo))]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(async () => {
    if (selectedProducts.length === 0) return;

    setLoading(true);
    setStores([]);

    try {
      const r = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdNos: selectedProducts.map((p) => p.pdNo),
        }),
      });
      const data = await r.json();
      const allStores: StoreInfo[] = data.stores ?? [];
      // Seoul only for now
      setStores(allStores.filter((s) => s.strAddr.includes("서울")));
    } catch {
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProducts]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stores, loading, search };
}
