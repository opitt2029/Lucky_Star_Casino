// hash / seed 顯示。value 為 null → 鎖定態；revealed && matchHex → 逐字元比對高亮（④揭露用）。
export default function SeedCard({ label, value, revealed = false, matchHex = null }) {
  const copy = () => value && navigator.clipboard?.writeText(value)
  return (
    <div className="seedcard">
      <div className="seedcard__label">{label}</div>
      {value == null ? (
        <div className="seedcard__value seedcard__locked">尚未揭露</div>
      ) : (
        <div className="seedcard__value">
          {revealed && matchHex
            ? value.split('').map((ch, i) => (
                <span
                  key={i}
                  className={ch === matchHex[i] ? 'seedcard__hex-match' : 'seedcard__hex-diff'}
                >
                  {ch}
                </span>
              ))
            : value}
          <button type="button" className="seedcard__copy" onClick={copy}>
            複製
          </button>
        </div>
      )}
    </div>
  )
}
