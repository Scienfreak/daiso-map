export type DaisoProduct = {
  pdNo: string;
  pdNm: string;
  pdPrc: number;
  imageUrl: string;
};

export type SelectedProduct = DaisoProduct & {
  requiredQty: number;
};

// inventories: pdNo -> qty
export type StoreInfo = {
  strCd: string;
  strNm: string;
  strAddr: string;
  strTno: string;
  opngTime: string;
  clsngTime: string;
  strLttd: number;
  strLitd: number;
  inventories: Record<string, number>;
};

// 'all' = green, 'partial' = yellow, 'none' = gray
export type StoreStatus = "all" | "partial" | "none";

export function getStoreStatus(
  store: StoreInfo,
  selectedProducts: SelectedProduct[]
): StoreStatus {
  if (selectedProducts.length === 0) return "none";
  let hasAll = true;
  let hasAny = false;
  for (const p of selectedProducts) {
    const qty = store.inventories[p.pdNo] ?? 0;
    if (qty >= p.requiredQty) {
      hasAny = true;
    } else {
      hasAll = false;
    }
  }
  if (hasAll) return "all";
  if (hasAny) return "partial";
  return "none";
}
