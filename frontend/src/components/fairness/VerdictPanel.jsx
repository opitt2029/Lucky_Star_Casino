// 三顆燈 + message（純展示）。commitmentValid / resultMatches / valid。
function Lamp({ label, on }) {
  return <div className={`verdict__lamp verdict__lamp--${on ? 'on' : 'off'}`}>{label}：{on ? '✓' : '✗'}</div>
}

export default function VerdictPanel({ commitmentValid, resultMatches, valid, message }) {
  return (
    <div>
      <div className="verdict">
        <Lamp label="承諾相符" on={commitmentValid} />
        <Lamp label="結果一致" on={resultMatches} />
        <Lamp label="整體通過" on={valid} />
      </div>
      {message && <div className="verdict__message">{message}</div>}
    </div>
  )
}
