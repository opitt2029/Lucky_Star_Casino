import { useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { useWebSocket } from '../hooks/useWebSocket'
import { upsertRankRows } from '../store/slices/rankSlice'
import { rankApi } from '../services/rankApi'

// 即時更新橋接：只訂閱後端「實際會廣播」的公共頻道。
// - /topic/rank：notification-service 廣播 RankUpdateEvent；需先 normalize 成前端榜單列形狀。
// - 錢包：後端無 /topic/wallet 公共頻道，餘額透過各操作的 REST 回應更新，故此處不訂閱。
// - 遊戲結果：後端送至私人佇列 /user/queue/notifications（GameResultConsumer），
//   已由 useWebSocket 內建訂閱處理（type=GAME_RESULT → updateGameResult），毋須再訂閱 /topic/game/result。
export default function RealtimeBridge() {
  const dispatch = useDispatch()
  const subscriptions = useMemo(
    () => ({
      '/topic/rank': (payload) => dispatch(upsertRankRows(rankApi.normalizeBroadcast(payload))),
    }),
    [dispatch]
  )

  useWebSocket(subscriptions)

  return null
}
