function formatTime(value) {
  if (!value) return '尚未同步'
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export default function RankRefreshStatus({ lastUpdatedAt, nextRefreshIn, refreshing, onRefresh }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
      <div className="grid gap-1 text-sm">
        <span className="text-yellow-100/70">最後同步：{formatTime(lastUpdatedAt)}</span>
        <span className="gold-muted font-bold">下次完整同步：{formatCountdown(nextRefreshIn)}</span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="gold-button rounded px-4 py-2 text-sm font-black transition disabled:cursor-wait disabled:opacity-60"
        aria-label="立即重新整理排行榜"
      >
        {refreshing ? '同步中...' : '立即重新整理'}
      </button>
    </div>
  )
}
