import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { fairnessApi } from '../services/fairnessApi'
import { fetchWallet } from '../store/slices/walletSlice'
import SlotFairPanel from '../components/fairness/panels/SlotFairPanel'
import BaccaratFairPanel from '../components/fairness/panels/BaccaratFairPanel'
import FishingFairPanel from '../components/fairness/panels/FishingFairPanel'
import '../components/fairness/fairness.css'

const GAMES = [
  { key: 'slot', label: '老虎機', Panel: SlotFairPanel },
  { key: 'baccarat', label: '百家樂', Panel: BaccaratFairPanel },
  { key: 'fishing', label: '捕魚機', Panel: FishingFairPanel },
]

export default function ProvablyFair() {
  const dispatch = useDispatch()
  const [game, setGame] = useState('slot')
  const isMock = fairnessApi.isMock
  const { Panel } = GAMES.find((g) => g.key === game)

  // 這頁沒包 AppShell（其他遊戲頁的餘額刷新來源），單獨直接進來或整頁重整時
  // redux wallet.balance 還是初始值 0，三個面板會誤判「星幣不足」。
  useEffect(() => {
    dispatch(fetchWallet())
  }, [dispatch])

  return (
    <div className="fairness">
      <h1>公平性驗證</h1>
      {isMock ? (
        <div>
          <span className="fairness__badge fairness__badge--mock">本機模擬</span>
          <div className="fairness__badge-note">
            承諾雜湊為真實 SHA-256 計算，但結果比對為同一份前端邏輯重跑，不構成對後端的獨立驗證。
          </div>
        </div>
      ) : (
        <span className="fairness__badge fairness__badge--real">真實後端</span>
      )}

      <div className="fairness__tabs">
        {GAMES.map((g) => (
          <button
            key={g.key}
            type="button"
            className={`fairness__tab ${game === g.key ? 'fairness__tab--active' : ''}`}
            onClick={() => setGame(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <Panel />
    </div>
  )
}
