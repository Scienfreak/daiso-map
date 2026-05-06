"use client";

export const SEOUL_DISTRICTS: { name: string; code: string }[] = [
  { name: "강남구", code: "11680" },
  { name: "강동구", code: "11740" },
  { name: "강북구", code: "11305" },
  { name: "강서구", code: "11500" },
  { name: "관악구", code: "11620" },
  { name: "광진구", code: "11215" },
  { name: "구로구", code: "11530" },
  { name: "금천구", code: "11545" },
  { name: "노원구", code: "11350" },
  { name: "도봉구", code: "11320" },
  { name: "동대문구", code: "11230" },
  { name: "동작구", code: "11590" },
  { name: "마포구", code: "11440" },
  { name: "서대문구", code: "11410" },
  { name: "서초구", code: "11650" },
  { name: "성동구", code: "11200" },
  { name: "성북구", code: "11290" },
  { name: "송파구", code: "11710" },
  { name: "양천구", code: "11470" },
  { name: "영등포구", code: "11560" },
  { name: "용산구", code: "11170" },
  { name: "은평구", code: "11380" },
  { name: "종로구", code: "11110" },
  { name: "중구",   code: "11140" },
  { name: "중랑구", code: "11260" },
];

type Props = {
  value: string;
  onChange: (code: string) => void;
};

export default function DistrictSelector({ value, onChange }: Props) {
  return (
    <div className="w-full max-w-md mt-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-2xl bg-white shadow-lg text-sm text-gray-800 border-none outline-none appearance-none cursor-pointer"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem center" }}
      >
        <option value="">서울 구 선택 (필수)</option>
        {SEOUL_DISTRICTS.map((d) => (
          <option key={d.code} value={d.code}>
            서울 {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
