// recomputed vs stored 並排逐欄比對（純展示）。stored 可能為 null（真實模式後端已存值）。
function rows(obj) {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj).map(([k, v]) => [k, JSON.stringify(v)])
}

export default function ResultDiff({ recomputed, stored }) {
  return (
    <div className="resultdiff">
      <div className="resultdiff__col">
        <div className="seedcard__label">重算結果 recomputed</div>
        {rows(recomputed).map(([k, v]) => (
          <div key={k} className="resultdiff__row">
            {k}: {v}
          </div>
        ))}
      </div>
      <div className="resultdiff__col">
        <div className="seedcard__label">紀錄 stored</div>
        {rows(stored).map(([k, v]) => (
          <div key={k} className="resultdiff__row">
            {k}: {v}
          </div>
        ))}
      </div>
    </div>
  )
}
