"use client";
import { useState } from "react";
import type { SelectedProduct } from "@/lib/types";

type Props = {
  products: SelectedProduct[];
  onQuantityChange: (pdNo: string, qty: number) => void;
  onRemove: (pdNo: string) => void;
  onSearch: () => void;
  loading: boolean;
  searchDisabled: boolean;
};

export default function ProductList({ products, onQuantityChange, onRemove, onSearch, loading, searchDisabled }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (products.length === 0) return null;

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden mt-2">
      {/* Header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-gray-800">
          선택한 제품 <span className="text-blue-600">{products.length}</span>개
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* List */}
      {!collapsed && (
        <ul className="divide-y divide-gray-100">
          {products.map((p) => (
            <li key={p.pdNo} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.pdNm}</p>
                <p className="text-xs text-gray-500">{p.pdPrc.toLocaleString()}원</p>
              </div>

              {/* Quantity control */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onQuantityChange(p.pdNo, Math.max(1, p.requiredQty - 1))}
                  className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-sm"
                >
                  −
                </button>
                <span className="w-6 text-center text-sm font-medium text-gray-800">
                  {p.requiredQty}
                </span>
                <button
                  onClick={() => onQuantityChange(p.pdNo, p.requiredQty + 1)}
                  className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors text-sm"
                >
                  +
                </button>
              </div>

              {/* Remove */}
              <button
                onClick={() => onRemove(p.pdNo)}
                className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors shrink-0"
                aria-label="제거"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Footer: legend + search button */}
      {!collapsed && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
              <span className="text-xs text-gray-600">전부 재고</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-yellow-400 inline-block" />
              <span className="text-xs text-gray-600">일부 재고</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-gray-400 inline-block" />
              <span className="text-xs text-gray-600">재고 없음</span>
            </div>
          </div>

          <button
            onClick={onSearch}
            disabled={loading || searchDisabled}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <span
                  className="w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block"
                  style={{ animation: "spin 0.7s linear infinite" }}
                />
                조회 중
              </>
            ) : (
              "지도에 표시"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
