import { useMemo } from 'react'
import { useDispatch } from 'react-redux'
import { useWebSocket } from '../hooks/useWebSocket'
import { updateGameResult } from '../store/slices/gameSlice'
import { upsertRankRows } from '../store/slices/rankSlice'
import { setBalance } from '../store/slices/walletSlice'

export default function RealtimeBridge() {
  const dispatch = useDispatch()
  const subscriptions = useMemo(
    () => ({
      '/topic/rank': (payload) => dispatch(upsertRankRows(payload)),
      '/topic/wallet': (payload) => dispatch(setBalance(payload)),
      '/topic/game/result': (payload) => dispatch(updateGameResult(payload)),
    }),
    [dispatch]
  )

  useWebSocket(subscriptions)

  return null
}
