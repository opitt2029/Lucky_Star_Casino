import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminApi } from '../services/adminApi'
import { useFetch } from '../hooks/useFetch'
import { fmtDateTime } from '../utils/format'
import {
  Badge,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination,
  Table,
  Td,
} from '../components/ui'

// 玩家管理（T-051）：分頁列表 + 關鍵字搜尋，點列進入詳情。
export default function Players() {
  const navigate = useNavigate()
  // input 是打字中的值、keyword 是「已送出」的查詢條件——分開兩個 state
  // 才不會每敲一個字就打一次 API（送出制，非即時搜尋）。
  const [input, setInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(0)

  const fetchPlayers = useCallback(
    () => adminApi.listPlayers({ page, size: 20, keyword: keyword || undefined }),
    [page, keyword]
  )
  const { data, loading, error, reload } = useFetch(fetchPlayers)

  function handleSearch(e) {
    e.preventDefault()
    setPage(0) // 新查詢條件回到第一頁，否則可能停在超出範圍的頁碼
    setKeyword(input.trim())
  }

  return (
    <div>
      <PageHeader title="玩家管理" description="查詢玩家帳號，點擊列進入詳情可停用/啟用（T-051）。" />

      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="帳號 / 暱稱關鍵字"
          className="w-64 rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          搜尋
        </button>
      </form>

      {loading && <LoadingBlock />}
      {!loading && error && <ErrorBlock message={error} onRetry={reload} />}
      {!loading && !error && data && data.content.length === 0 && (
        <EmptyBlock text={keyword ? `找不到符合「${keyword}」的玩家` : '目前沒有玩家資料'} />
      )}
      {!loading && !error && data && data.content.length > 0 && (
        <>
          <Table head={['ID', '帳號', '暱稱', '角色', '狀態', '註冊時間']}>
            {data.content.map((p) => (
              <tr
                key={p.playerId}
                onClick={() => navigate(`/players/${p.playerId}`)}
                className="cursor-pointer hover:bg-slate-50"
              >
                <Td className="tabular-nums">{p.playerId}</Td>
                <Td className="font-medium">{p.username}</Td>
                <Td>{p.nickname || '-'}</Td>
                <Td>{p.role}</Td>
                <Td>
                  {p.disabled ? <Badge color="red">已停用</Badge> : <Badge color="green">正常</Badge>}
                </Td>
                <Td className="text-slate-500">{fmtDateTime(p.createdAt)}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
