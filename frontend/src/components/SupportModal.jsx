import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { closeSupport } from '../store/slices/uiSlice'
import { claimBankruptcyAid, clearBankruptcyNotice, fetchWallet } from '../store/slices/walletSlice'

// 破產補助門檻（與後端 BankruptcyAidService.BALANCE_THRESHOLD 一致）：總餘額低於此值才可領取。
const BANKRUPTCY_AID_THRESHOLD = 100

// 客服說明彈窗：渲染在 App 根層，全頁可用。AppShell 頭像下拉與 QuickToolbar「客服」
// 都 dispatch openSupport 開啟同一彈窗（uiSlice 控制），行為一致。
export default function SupportModal() {
  const dispatch = useDispatch()
  const supportOpen = useSelector((state) => state.ui.supportOpen)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const player = useSelector((state) => state.auth.player)
  const wallet = useSelector((state) => state.wallet)
  const balance = wallet.balance
  const bankruptcyAid = wallet.bankruptcyAid
  const isBankruptcyEligible = isAuthenticated && balance < BANKRUPTCY_AID_THRESHOLD

  // 每次開啟時清掉上一輪的成功/錯誤訊息，避免殘留。
  useEffect(() => {
    if (supportOpen) {
      dispatch(clearBankruptcyNotice())
    }
  }, [supportOpen, dispatch])

  const handleClaimBankruptcyAid = async () => {
    if (!player?.id) return
    try {
      await dispatch(claimBankruptcyAid()).unwrap()
      dispatch(fetchWallet())
    } catch {
      // 失敗訊息已寫入 wallet.bankruptcyAid.error，於彈窗中顯示
    }
  }

  if (!supportOpen) return null

  return (
    <section
      className="fixed inset-0 z-50 grid place-items-center bg-red-950/72 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-title"
    >
      <div className="luxury-panel max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-auto rounded p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Support</p>
            <h2 id="support-title" className="brand-title mt-1 text-2xl font-black">
              客服說明
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dispatch(closeSupport())}
            className="red-gold-button rounded px-3 py-2 text-xs font-black"
          >
            關閉
          </button>
        </div>

        <div className="mt-5 rounded border border-yellow-200/15 bg-red-950/70 p-4">
          <h3 className="gold-text text-lg font-black">破產補助金</h3>
          <p className="mt-2 text-sm leading-6 text-yellow-100/80">
            當星幣輸光、餘額低於 {BANKRUPTCY_AID_THRESHOLD} 時，每天可免費領取一次救濟金，
            讓你能繼續遊玩，不必擔心歸零後卡關。
          </p>
          <ol className="mt-3 grid gap-1 text-sm text-yellow-100/72">
            <li>1. 確認目前星幣餘額低於 {BANKRUPTCY_AID_THRESHOLD}。</li>
            <li>2. 點擊下方「領取破產補助」。</li>
            <li>3. 系統發放 1,000 星幣並更新餘額；每日限領一次。</li>
          </ol>

          <div className="mt-4 flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/60 px-3 py-2">
            <span className="text-sm font-bold text-yellow-100/72">目前星幣</span>
            <span className="text-lg font-black text-yellow-100">{balance.toLocaleString()}</span>
          </div>

          <button
            type="button"
            onClick={handleClaimBankruptcyAid}
            disabled={!isBankruptcyEligible || bankruptcyAid.loading}
            className="gold-button mt-3 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55"
          >
            {bankruptcyAid.loading
              ? '領取中...'
              : isBankruptcyEligible
                ? '領取破產補助（+1,000）'
                : `餘額需低於 ${BANKRUPTCY_AID_THRESHOLD} 才可領取`}
          </button>

          {bankruptcyAid.message && (
            <p className="mt-3 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-200">
              {bankruptcyAid.message}
            </p>
          )}
          {bankruptcyAid.error && (
            <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
              {bankruptcyAid.error}
            </p>
          )}
        </div>

        <p className="mt-4 text-xs leading-5 text-yellow-100/54">
          其他問題請洽客服信箱 support@luckystar.example；本平台為模擬幣娛樂，星幣與鑽石皆無真實貨幣價值。
        </p>
      </div>
    </section>
  )
}
