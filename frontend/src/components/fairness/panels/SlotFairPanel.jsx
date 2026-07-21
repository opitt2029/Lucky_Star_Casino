import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fairnessApi } from '../../../services/fairnessApi'
import { sha256Hex } from '../../../services/provablyFairMock'
import { setBalance } from '../../../store/slices/walletSlice'
import StepRail from '../StepRail'
import SeedCard from '../SeedCard'
import VerdictPanel from '../VerdictPanel'
import ResultDiff from '../ResultDiff'

const STEPS = [
  { key: 'commit', label: '承諾' },
  { key: 'bet', label: '下注' },
  { key: 'reveal', label: '開獎/揭露' },
  { key: 'verify', label: '驗證' },
]

export default function SlotFairPanel() {
  const dispatch = useDispatch()
  const balance = useSelector((s) => s.wallet.balance)
  const [bet] = useState(100)
  const [clientSeed, setClientSeed] = useState('')
  const [round, setRound] = useState(null)
  const [settle, setSettle] = useState(null)
  const [revealHash, setRevealHash] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 4 : settle ? 3 : round ? 2 : 0

  async function doCommit() {
    setError('')
    if (balance < bet) {
      setError('星幣不足，無法下注')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setSettle(null)
      setRevealHash(null)
      setRound(await fairnessApi.slotRound({ bet, clientSeed: clientSeed || undefined }))
    } catch (e) {
      setError(`承諾失敗：${e.message}（POST /api/v1/game/slot/round）`)
    } finally {
      setBusy(false)
    }
  }

  async function doSettle() {
    setBusy(true)
    try {
      const s = await fairnessApi.slotSettle({ roundId: round.roundId })
      setSettle(s)
      setRevealHash(await sha256Hex(s.serverSeed))
      if (!fairnessApi.isMock && s.wallet) dispatch(setBalance({ balance: s.wallet.balance }))
    } catch (e) {
      setError(`結算失敗：${e.message}（保留承諾可重試）`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify(tampered) {
    setBusy(true)
    try {
      const seed = tampered
        ? settle.serverSeed.slice(0, -1) + (settle.serverSeed.endsWith('0') ? '1' : '0')
        : undefined
      setVerdict(await fairnessApi.verifyRound({ roundId: round.roundId, serverSeed: seed }))
    } catch (e) {
      setError(`驗證失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <StepRail steps={STEPS} current={current} />
      {error && <div className="fairness__error">{error}</div>}

      <SeedCard label="serverSeedHash（承諾）" value={round?.serverSeedHash ?? null} />
      <SeedCard label="serverSeed" value={settle?.serverSeed ?? null} />
      <label className="seedcard__label">
        你的 clientSeed（可自訂，留空則伺服器產生）
        <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} disabled={!!round} />
      </label>
      {!round && balance < bet && <div className="fairness__error">星幣不足，無法下注</div>}
      {!round && (
        <button type="button" className="fairness__button" onClick={doCommit} disabled={busy || balance < bet}>
          鎖定本局（下注 {bet}）
        </button>
      )}

      {round && !settle && (
        <button type="button" className="fairness__button" onClick={doSettle} disabled={busy}>
          下注並開獎（此時才扣款）
        </button>
      )}
      {settle && (
        <>
          <div className="resultdiff__row">倍率 {settle.multiplier}／派彩 {settle.payout}</div>
          <SeedCard label="SHA-256(serverSeed)（應等於承諾）" value={revealHash} revealed matchHex={round.serverSeedHash} />
        </>
      )}

      {settle && (
        <div className="fairness__tabs">
          <button type="button" className="fairness__button" onClick={() => doVerify(false)} disabled={busy}>
            驗證這一局
          </button>
          <button type="button" className="fairness__button" onClick={() => doVerify(true)} disabled={busy}>
            模擬伺服器作弊
          </button>
        </div>
      )}
      {verdict && (
        <>
          <VerdictPanel
            commitmentValid={verdict.commitmentValid}
            resultMatches={verdict.resultMatches}
            valid={verdict.valid}
            message={verdict.message}
          />
          <ResultDiff recomputed={verdict.recomputed} stored={verdict.stored} />
        </>
      )}
    </div>
  )
}
