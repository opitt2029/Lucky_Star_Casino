// 骨架期的頁面佔位：標題 + 預計要串的 API 清單。
// 實作該頁時整個換掉，不保留此元件的使用。
export default function PageStub({ title, description, apis = [] }) {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-bold">{title}</h1>
      <p className="mb-6 text-sm text-slate-500">{description}</p>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6">
        <p className="mb-3 text-sm font-medium text-slate-600">此頁尚未實作，預計串接：</p>
        <ul className="space-y-1">
          {apis.map((apiDesc) => (
            <li key={apiDesc} className="font-mono text-xs text-slate-500">
              {apiDesc}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
