"use client";
import { useEffect, useRef, useState } from "react";
import type { SelectedProduct, StoreInfo } from "@/lib/types";
import { getStoreStatus } from "@/lib/types";

declare global {
  interface Window {
    kakao: {
      maps: {
        load: (callback: () => void) => void;
        Map: new (container: HTMLElement, options: object) => KakaoMapInstance;
        LatLng: new (lat: number, lng: number) => KakaoLatLng;
        CustomOverlay: new (options: object) => KakaoOverlay;
      };
    };
  }
}

interface KakaoMapInstance {
  setCenter: (latlng: KakaoLatLng) => void;
}
interface KakaoLatLng {}
interface KakaoOverlay {
  setMap: (map: KakaoMapInstance | null) => void;
  getContent: () => HTMLElement;
}

const STATUS_COLOR: Record<string, string> = {
  all: "#22c55e",
  partial: "#eab308",
  none: "#9ca3af",
};

type Props = {
  stores: StoreInfo[];
  selectedProducts: SelectedProduct[];
  loading: boolean;
};

type PopupInfo = {
  store: StoreInfo;
};

export default function KakaoMap({ stores, selectedProducts, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMapInstance | null>(null);
  const overlaysRef = useRef<KakaoOverlay[]>([]);
  const popupOverlayRef = useRef<KakaoOverlay | null>(null);
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapStatus, setMapStatus] = useState("SDK 로딩 중...");

  // Initialize map once — load SDK dynamically for reliable Android support
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

    function init() {
      if (!containerRef.current) return;
      setMapStatus("지도 초기화 중...");
      try {
        const map = new window.kakao.maps.Map(containerRef.current, {
          center: new window.kakao.maps.LatLng(37.5665, 126.978),
          level: 8,
        });
        mapRef.current = map;
        setMapReady(true);
        setMapStatus("");
      } catch (e) {
        setMapError(`지도 초기화 오류: ${e}`);
      }
    }

    function attachScript() {
      setMapStatus("Kakao SDK 로딩 중...");
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&autoload=false`;
      script.onload = () => {
        setMapStatus("SDK 로드 완료, 지도 초기화 중...");
        window.kakao.maps.load(init);
      };
      script.onerror = () => {
        setMapError(`Kakao SDK 로딩 실패 (API 키: ${apiKey ? apiKey.slice(0, 8) + "..." : "없음"})`);
      };
      document.head.appendChild(script);
    }

    if (window.kakao?.maps) {
      window.kakao.maps.load(init);
    } else {
      attachScript();
    }
  }, []);

  // Rebuild markers when stores or selectedProducts change
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    // Clear existing overlays
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    // Close popup
    if (popupOverlayRef.current) {
      popupOverlayRef.current.setMap(null);
      popupOverlayRef.current = null;
    }
    setPopup(null);

    stores.forEach((store) => {
      const status = getStoreStatus(store, selectedProducts);
      const color = STATUS_COLOR[status];

      const markerEl = document.createElement("div");
      markerEl.style.cssText = `
        width: 14px; height: 14px;
        border-radius: 50%;
        background: ${color};
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
        cursor: pointer;
        transition: transform 0.1s;
      `;
      markerEl.addEventListener("mouseenter", () => {
        markerEl.style.transform = "scale(1.4)";
      });
      markerEl.addEventListener("mouseleave", () => {
        markerEl.style.transform = "scale(1)";
      });
      markerEl.addEventListener("click", () => {
        setPopup({ store });
      });

      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(store.strLttd, store.strLitd),
        content: markerEl,
        zIndex: 1,
      });
      overlay.setMap(map);
      overlaysRef.current.push(overlay);
    });
  }, [stores, selectedProducts, mapReady]);

  // Render popup overlay when popup state changes
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    // Remove previous popup overlay
    if (popupOverlayRef.current) {
      popupOverlayRef.current.setMap(null);
      popupOverlayRef.current = null;
    }

    if (!popup) return;

    const { store } = popup;

    const el = document.createElement("div");
    el.style.cssText = `
      position: relative;
      background: white;
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      min-width: 220px;
      max-width: 280px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      transform: translateX(-50%) translateY(calc(-100% - 16px));
    `;

    // Balloon tail (pointing down toward the marker)
    const tail = document.createElement("div");
    tail.style.cssText = `
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 10px solid white;
      filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));
    `;
    el.appendChild(tail);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      position: absolute; top: 8px; right: 10px;
      background: none; border: none; font-size: 18px;
      color: #9ca3af; cursor: pointer; line-height: 1;
    `;
    closeBtn.addEventListener("click", () => setPopup(null));
    el.appendChild(closeBtn);

    // Store name
    const name = document.createElement("p");
    name.textContent = store.strNm;
    name.style.cssText = "font-size:15px;font-weight:700;color:#111827;margin:0 0 6px 0;padding-right:20px;";
    el.appendChild(name);

    // Address
    const addr = document.createElement("p");
    addr.textContent = store.strAddr;
    addr.style.cssText = "font-size:12px;color:#6b7280;margin:0 0 3px 0;";
    el.appendChild(addr);

    // Phone
    if (store.strTno) {
      const tel = document.createElement("p");
      tel.textContent = `📞 ${store.strTno}`;
      tel.style.cssText = "font-size:12px;color:#6b7280;margin:0 0 3px 0;";
      el.appendChild(tel);
    }

    // Hours
    const hours = document.createElement("p");
    const fmt = (t: string) => `${t.slice(0, 2)}:${t.slice(2)}`;
    hours.textContent = `🕐 ${fmt(store.opngTime)} ~ ${fmt(store.clsngTime)}`;
    hours.style.cssText = "font-size:12px;color:#6b7280;margin:0 0 10px 0;";
    el.appendChild(hours);

    // Inventory per product
    if (selectedProducts.length > 0) {
      const divider = document.createElement("hr");
      divider.style.cssText = "border:none;border-top:1px solid #f3f4f6;margin:0 0 8px 0;";
      el.appendChild(divider);

      for (const p of selectedProducts) {
        const qty = store.inventories[p.pdNo] ?? 0;
        const row = document.createElement("div");
        row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;";

        const label = document.createElement("span");
        label.textContent = p.pdNm.length > 16 ? p.pdNm.slice(0, 16) + "…" : p.pdNm;
        label.style.cssText = "font-size:12px;color:#374151;flex:1;min-width:0;margin-right:8px;";

        const qtyEl = document.createElement("span");
        const sufficient = qty >= p.requiredQty;
        qtyEl.textContent = qty > 0 ? `${qty}개` : "품절";
        qtyEl.style.cssText = `font-size:12px;font-weight:600;color:${sufficient ? "#16a34a" : "#dc2626"};white-space:nowrap;`;

        row.appendChild(label);
        row.appendChild(qtyEl);
        el.appendChild(row);
      }
    }

    const overlay = new window.kakao.maps.CustomOverlay({
      position: new window.kakao.maps.LatLng(store.strLttd, store.strLitd),
      content: el,
      zIndex: 10,
      yAnchor: 0,
    });
    overlay.setMap(map);
    popupOverlayRef.current = overlay;
  }, [popup, selectedProducts, mapReady]);

  return (
    <div className="relative w-full h-full" style={{ minHeight: 0 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Error display */}
      {mapError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', padding: '24px' }}>
          <p style={{ color: '#dc2626', fontSize: '14px', textAlign: 'center', fontWeight: 600, marginBottom: '8px' }}>지도 로딩 실패</p>
          <p style={{ color: '#7f1d1d', fontSize: '12px', textAlign: 'center' }}>{mapError}</p>
        </div>
      )}

      {/* Loading state (before map is ready and no error) */}
      {!mapReady && !mapError && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid #d1d5db', borderTopColor: '#3b82f6', borderRadius: '50%', marginBottom: '12px', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: '#6b7280', fontSize: '13px' }}>{mapStatus}</p>
        </div>
      )}

      {loading && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg px-4 py-2 flex items-center gap-2 z-10">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-sm text-gray-600">재고 조회 중...</span>
        </div>
      )}
    </div>
  );
}
