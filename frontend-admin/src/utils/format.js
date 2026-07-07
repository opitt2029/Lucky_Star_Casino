// 顯示層格式化工具。金額在後端一律是整數星幣（long），前端只做千分位顯示。

export function fmtInt(n) {
  if (n === null || n === undefined) return '-'
  return Number(n).toLocaleString('zh-TW')
}

// 後端 LocalDateTime 序列化成無時區 ISO 字串（如 2026-07-07T12:34:56），
// 後台看到「分」的精度就夠，直接字串裁切、不經 Date 解析（避免時區位移誤導）。
export function fmtDateTime(s) {
  if (!s) return '-'
  return s.replace('T', ' ').slice(0, 16)
}

// RTP 是 0~1 的比率，顯示成百分比（小數兩位）
export function fmtPercent(v) {
  if (v === null || v === undefined) return '-'
  return `${(v * 100).toFixed(2)}%`
}

// 回傳本地時區的 YYYY-MM-DD（toISOString 是 UTC，直接用會在午夜前後差一天）
export function isoDate(d) {
  const tzOffsetMs = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10)
}

export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}
