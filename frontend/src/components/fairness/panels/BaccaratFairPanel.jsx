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
  { key: 'commit', label: '承諾+下注' },
  { key: 'reveal', label: '開獎/揭露' },
  { key: 'verify', label: '驗證' },
]
const AMOUNT = 100

export default function BaccaratFairPanel() {
  const dispatch = useDispatch()
  const balance = useSelector((s) => s.wallet.balance)
  const [area, setArea] = useState('player')
  const [clientSeed, setClientSeed] = useState('')
  const [betResp, setBetResp] = useState(null)
  const [result, setResult] = useState(null)
  const [revealHash, setRevealHash] = useState(null)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 3 : result ? 2 : betResp ? 1 : 0

  async function doBet() {
    setError('')
    if (balance < AMOUNT) {
      setError('星幣不足，無法下注')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setResult(null)
      setRevealHash(null)
      const body = { player: 0, banker: 0, tie: 0, [area]: AMOUNT, clientSeed: clientSeed || undefined }
      setBetResp(await fairnessApi.baccaratBet(body))
    } catch (e) {
      setError(`下注失敗：${e.message}（POST /api/v1/game/baccarat/bet）`)
    } finally {
      setBusy(false)
    }
  }

  async function doResult() {
    setBusy(true)
    try {
      const r = await fairnessApi.baccaratResult({ roundId: betResp.roundId })
      setResult(r)
      setRevealHash(await sha256Hex(r.serverSeed))
      if (!fairnessApi.isMock && r.wallet) dispatch(setBalance({ balance: r.wallet.balance }))
    } catch (e) {
      setError(`開獎失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify(tampered) {
    setBusy(true)
    try {
      const seed = tampered
        ? result.serverSeed.slice(0, -1) + (result.serverSeed.endsWith('0') ? '1' : '0')
        : undefined
      setVerdict(await fairnessApi.verifyRound({ roundId: betResp.roundId, serverSeed: seed }))
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
      <div className="fairness__badge-note">注意：百家樂在下注（bet）時就扣款，與老虎機（結算才扣）不同。</div>

      <SeedCard label="serverSeedHash（承諾）" value={betResp?.serverSeedHash ?? null} />
      <SeedCard label="serverSeed" value={result?.serverSeed ?? null} />
      {!betResp && balance < AMOUNT && <div className="fairness__error">星幣不足，無法下注</div>}
      {!betResp && (
        <>
          <div className="fairness__tabs">
            {['player', 'banker', 'tie'].map((a) => (
              <button
                key={a}
                type="button"
                className={`fairness__tab ${area === a ? 'fairness__tab--active' : ''}`}
                onClick={() => setArea(a)}
              >
                {a === 'player' ? '閒' : a === 'banker' ? '莊' : '和'}
              </button>
            ))}
          </div>
          <label className="seedcard__label">
            你的 clientSeed（可自訂）
            <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} />
          </label>
          <button type="button" onClick={doBet} disabled={busy || balance < AMOUNT}>
            下注 {AMOUNT} 到「{area === 'player' ? '閒' : area === 'banker' ? '莊' : '和'}」（此時扣款）
          </button>
        </>
      )}

      {betResp && !result && (
        <button type="button" onClick={doResult} disabled={busy}>
          開獎並揭露
        </button>
      )}
      {result && (
        <>
          <div className="resultdiff__row">
            閒 {result.playerScore}（{(result.playerCards || []).join(' ')}）｜莊 {result.bankerScore}（
            {(result.bankerCards || []).join(' ')}）｜結果 {result.result}
          </div>
          <SeedCard label="SHA-256(serverSeed)（應等於承諾）" value={revealHash} revealed matchHex={betResp.serverSeedHash} />
          <div className="fairness__tabs">
            <button type="button" onClick={() => doVerify(false)} disabled={busy}>
              驗證這一局
            </button>
            <button type="button" onClick={() => doVerify(true)} disabled={busy}>
              模擬伺服器作弊
            </button>
          </div>
        </>
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
