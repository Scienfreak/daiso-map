"use client";
import { useState, useCallback, useEffect } from "react";
import type { SelectedProduct, StoreInfo } from "@/lib/types";

export function useInventory(selectedProducts: SelectedProduct[], districtCode: string) {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Clear map when product list or district changes
  useEffect(() => {
    setStores([]);
  }, [JSON.stringify(selectedProducts.map((p) => p.pdNo)), districtCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(async () => {
    if (selectedProducts.length === 0 || !districtCode) return;

    setLoading(true);
    setStores([]);

    try {
      const r = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdNos: selectedProducts.map((p) => p.pdNo),
          districtCode,
        }),
      });
      const data = await r.json();
      setStores(data.stores ?? []);
    } catch {
      setStores([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProducts, districtCode]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stores, loading, search };
}
