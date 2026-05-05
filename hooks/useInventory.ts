"use client";
import { useState, useEffect } from "react";
import type { SelectedProduct, StoreInfo } from "@/lib/types";

export function useInventory(selectedProducts: SelectedProduct[]) {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedProducts.length === 0) {
      setStores([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pdNos: selectedProducts.map((p) => p.pdNo),
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setStores(data.stores ?? []);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    // Re-fetch when product list or required quantities change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(selectedProducts.map((p) => ({ pdNo: p.pdNo, requiredQty: p.requiredQty }))),
  ]);

  return { stores, loading };
}
