import { describe, expect, test } from 'vitest'
import { sha256Hex, commit, createStream, provablyFairMock } from './provablyFairMock'

describe('provablyFairMock crypto core', () => {
  // 已知向量：SHA-256("abc") = ba7816bf... （FIPS 180-2 範例）
  test('sha256Hex 對照已知向量', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test('commit = SHA-256(serverSeed)，小寫 hex', async () => {
    const seed = 'deadbeef'
    expect(await commit(seed)).toBe(await sha256Hex(seed))
    expect(await commit(seed)).toMatch(/^[0-9a-f]{64}$/)
  })

  test('同一三元組必產生相同序列（確定性）', async () => {
    const s1 = createStream('server-1', 'client-1', 0)
    const s2 = createStream('server-1', 'client-1', 0)
    const a = await s1.nextInts(10, 103)
    const b = await s2.nextInts(10, 103)
    expect(a).toEqual(b)
  })

  test('不同 nonce 產生不同序列', async () => {
    const a = await createStream('server-1', 'client-1', 0).nextInts(5, 256)
    const b = await createStream('server-1', 'client-1', 1).nextInts(5, 256)
    expect(a).not.toEqual(b)
  })

  test('nextInt 值域落在 [0, bound)', async () => {
    const s = createStream('server-x', 'client-x', 7)
    for (let i = 0; i < 200; i++) {
      const v = await s.nextInt(13)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(13)
    }
  })
})

describe('provablyFairMock 老虎機 round/settle/verify', () => {
  test('settle 揭露的 serverSeed 雜湊 == round 承諾雜湊', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    expect(round.serverSeedHash).toMatch(/^[0-9a-f]{64}$/)
    expect(round.serverSeed).toBeUndefined()
    const settle = await provablyFairMock.slotSettle({ roundId: round.roundId })
    expect(await sha256Hex(settle.serverSeed)).toBe(round.serverSeedHash)
  })

  test('verify 用揭露值 → commitmentValid && resultMatches && valid', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    await provablyFairMock.slotSettle({ roundId: round.roundId })
    const v = await provablyFairMock.verifyRound({ roundId: round.roundId })
    expect(v.commitmentValid).toBe(true)
    expect(v.resultMatches).toBe(true)
    expect(v.valid).toBe(true)
  })

  test('作弊演示：竄改 serverSeed → commitmentValid=false、valid=false', async () => {
    const round = await provablyFairMock.slotRound({ bet: 100, clientSeed: 'my-seed' })
    const settle = await provablyFairMock.slotSettle({ roundId: round.roundId })
    const tampered = settle.serverSeed.slice(0, -1) + (settle.serverSeed.endsWith('0') ? '1' : '0')
    const v = await provablyFairMock.verifyRound({ roundId: round.roundId, serverSeed: tampered })
    expect(v.usedProvidedSeed).toBe(true)
    expect(v.commitmentValid).toBe(false)
    expect(v.valid).toBe(false)
  })
})
