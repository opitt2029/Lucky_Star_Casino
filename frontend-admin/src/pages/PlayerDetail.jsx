import { useParams } from 'react-router-dom'
import PageStub from '../components/PageStub'

export default function PlayerDetail() {
  const { playerId } = useParams()
  return (
    <PageStub
      title={`玩家詳情 #${playerId}`}
      description="跨庫彙整 member/wallet/game 資料，含停用/啟用開關（T-051/T-108）。"
      apis={[
        `GET /admin/players/${playerId}`,
        `PATCH /admin/players/${playerId}/status（body: { enabled }，停用即時寫 Redis 封鎖）`,
      ]}
    />
  )
}
