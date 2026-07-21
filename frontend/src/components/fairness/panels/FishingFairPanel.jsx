import { useState } from 'react'
import { useSelector } from 'react-redux'
import { fairnessApi } from '../../../services/fairnessApi'
import fishingSpecies from '../../../../../contracts/fishing-species.json'
import StepRail from '../StepRail'
import SeedCard from '../SeedCard'
import VerdictPanel from '../VerdictPanel'

const STEPS = [
  { key: 'commit', label: '承諾/入場' },
  { key: 'shoot', label: '射擊' },
  { key: 'reveal', label: '揭露' },
  { key: 'verify', label: '逐發驗證' },
]
const BUY_IN = 1000
const BET_PER_SHOT = 10
const CANNON = 1
const SHOT_COUNT = 8
const DEMO_FISH = fishingSpecies.species.find((f) => f.tier === 'SMALL')?.code || fishingSpecies.species[0].code

export default function FishingFairPanel() {
  const balance = useSelector((s) => s.wallet.balance)
  const [clientSeed, setClientSeed] = useState('')
  const [session, setSession] = useState(null)
  const [shots, setShots] = useState([])
  const [ended, setEnded] = useState(null)
  const [verifySeq, setVerifySeq] = useState(1)
  const [verdict, setVerdict] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const current = verdict ? 4 : ended ? 3 : shots.length ? 2 : session ? 1 : 0

  async function doStart() {
    setError('')
    if (balance < BUY_IN) {
      setError('星幣不足，無法入場')
      return
    }
    setBusy(true)
    try {
      setVerdict(null)
      setEnded(null)
      setShots([])
      setSession(
        await fairnessApi.fishingStart({
          buyIn: BUY_IN,
          cannonLevel: CANNON,
          betPerShot: BET_PER_SHOT,
          clientSeed: clientSeed || undefined,
        }),
      )
    } catch (e) {
      setError(`入場失敗：${e.message}（POST /api/v1/game/fishing/session/start）`)
    } finally {
      setBusy(false)
    }
  }

  async function doShoot() {
    setBusy(true)
    try {
      const batch = Array.from({ length: SHOT_COUNT }, (_, i) => ({
        shotSeq: shots.length + i + 1,
        fishType: DEMO_FISH,
        betPerShot: BET_PER_SHOT,
        cannonLevel: CANNON,
        fishInstanceId: 'demo-fish',
      }))
      const resp = await fairnessApi.fishingShots({ sessionId: session.sessionId, shots: batch })
      setShots((prev) => [...prev, ...resp.results])
    } catch (e) {
      setError(`射擊失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doEnd() {
    setBusy(true)
    try {
      setEnded(await fairnessApi.fishingEnd({ sessionId: session.sessionId }))
    } catch (e) {
      setError(`結算失敗：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function doVerify() {
    setBusy(true)
    try {
      setVerdict(
        await fairnessApi.fishingVerifyShot({
          sessionId: session.sessionId,
          shotSeq: verifySeq,
          fishType: DEMO_FISH,
          betPerShot: BET_PER_SHOT,
        }),
      )
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

      <SeedCard label="serverSeedHash（承諾）" value={session?.serverSeedHash ?? null} />
      <SeedCard label="serverSeed" value={ended?.serverSeed ?? null} />
      {!session && balance < BUY_IN && <div className="fairness__error">星幣不足，無法入場</div>}
      {!session && (
        <>
          <label className="seedcard__label">
            你的 clientSeed（可自訂）
            <input value={clientSeed} onChange={(e) => setClientSeed(e.target.value)} />
          </label>
          <button type="button" onClick={doStart} disabled={busy || balance < BUY_IN}>
            入場（buy-in {BUY_IN}，每發 {BET_PER_SHOT}）
          </button>
        </>
      )}

      {session && !ended && (
        <button type="button" onClick={doShoot} disabled={busy}>
          開火 {SHOT_COUNT} 發（目標：{DEMO_FISH}）
        </button>
      )}

      {shots.length > 0 && (
        <div className="resultdiff__col">
          {shots.map((s) => (
            <div key={s.shotSeq} className="resultdiff__row">
              #{s.shotSeq} 傷害 {s.damage}
              {s.crit ? '（暴擊）' : ''} {s.killed ? (s.captured ? `→ 捕獲 派彩 ${s.payout}` : '→ 掙脫') : `剩 HP ${s.hpRemaining}`}
            </div>
          ))}
        </div>
      )}

      {session && shots.length > 0 && !ended && (
        <button type="button" onClick={doEnd} disabled={busy}>
          收網並揭露 serverSeed
        </button>
      )}
      {ended && (
        <div className="fairness__tabs">
          <label className="seedcard__label">
            驗證第幾發
            <input
              type="number"
              min="1"
              value={verifySeq}
              onChange={(e) => setVerifySeq(Number(e.target.value))}
            />
          </label>
          <button type="button" onClick={doVerify} disabled={busy}>
            逐發驗證
          </button>
        </div>
      )}
      {verdict && (
        <VerdictPanel
          commitmentValid={verdict.commitmentValid}
          resultMatches={verdict.commitmentValid}
          valid={verdict.commitmentValid}
          message={verdict.message}
        />
      )}
    </div>
  )
}
