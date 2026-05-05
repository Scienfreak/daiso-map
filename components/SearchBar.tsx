"use client";
import { useState, useRef, useEffect } from "react";
import type { DaisoProduct, SelectedProduct } from "@/lib/types";
import { useDebounce } from "@/hooks/useDebounce";

type Props = {
  onProductSelect: (product: SelectedProduct) => void;
  selectedPdNos: Set<string>;
};

export default function SearchBar({ onProductSelect, selectedPdNos }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DaisoProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debouncedQuery.trim().length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setResults(data.items ?? []);
          setOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSelect(product: DaisoProduct) {
    onProductSelect({ ...product, requiredQty: 1 });
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="flex items-center bg-white rounded-2xl shadow-lg px-4 py-3 gap-2">
        <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="다이소 제품 검색..."
          className="flex-1 outline-none text-sm text-gray-800 placeholder-gray-400 bg-transparent"
        />
        {loading && (
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin shrink-0" />
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-xl z-50 overflow-y-auto" style={{ maxHeight: '340px' }}>
          {results.map((product) => {
            const alreadyAdded = selectedPdNos.has(product.pdNo);
            return (
              <li key={product.pdNo} className="border-b border-gray-100 last:border-0">
                <button
                  onClick={() => !alreadyAdded && handleSelect(product)}
                  className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                    alreadyAdded
                      ? "opacity-50 cursor-not-allowed bg-gray-50"
                      : "hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
                  }`}
                  disabled={alreadyAdded}
                >
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.imageUrl}
                      alt={product.pdNm}
                      className="w-12 h-12 rounded-lg object-cover shrink-0 bg-gray-100"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{product.pdNm}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{product.pdPrc.toLocaleString()}원</p>
                  </div>
                  {alreadyAdded && (
                    <span className="text-xs text-green-600 font-medium shrink-0">추가됨</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && results.length === 0 && !loading && debouncedQuery.trim().length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl shadow-xl px-4 py-3 z-50">
          <p className="text-sm text-gray-500">검색 결과가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
