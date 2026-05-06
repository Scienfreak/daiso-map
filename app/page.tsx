"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { SelectedProduct } from "@/lib/types";
import SearchBar from "@/components/SearchBar";
import ProductList from "@/components/ProductList";
import DistrictSelector from "@/components/DistrictSelector";
import { useInventory } from "@/hooks/useInventory";

const KakaoMap = dynamic(() => import("@/components/KakaoMap"), { ssr: false });

export default function Home() {
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [districtCode, setDistrictCode] = useState("");
  const { stores, loading, search } = useInventory(selectedProducts, districtCode);

  const selectedPdNos = new Set(selectedProducts.map((p) => p.pdNo));

  function handleProductSelect(product: SelectedProduct) {
    setSelectedProducts((prev) => {
      if (prev.some((p) => p.pdNo === product.pdNo)) return prev;
      return [...prev, product];
    });
  }

  function handleQuantityChange(pdNo: string, qty: number) {
    setSelectedProducts((prev) =>
      prev.map((p) => (p.pdNo === pdNo ? { ...p, requiredQty: qty } : p))
    );
  }

  function handleRemove(pdNo: string) {
    setSelectedProducts((prev) => prev.filter((p) => p.pdNo !== pdNo));
  }

  return (
    <div className="relative w-full" style={{ height: "100dvh" }}>
      <KakaoMap
        stores={stores}
        selectedProducts={selectedProducts}
        loading={loading}
      />

      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center w-full px-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md flex flex-col">
          <SearchBar
            onProductSelect={handleProductSelect}
            selectedPdNos={selectedPdNos}
          />
          <DistrictSelector value={districtCode} onChange={setDistrictCode} />
          <ProductList
            products={selectedProducts}
            onQuantityChange={handleQuantityChange}
            onRemove={handleRemove}
            onSearch={search}
            loading={loading}
            searchDisabled={!districtCode || selectedProducts.length === 0}
          />
        </div>
      </div>
    </div>
  );
}
