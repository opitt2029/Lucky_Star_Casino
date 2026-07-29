import { describe, expect, it } from 'vitest'
import reducer, { rankKey, upsertRankRows } from './rankSlice'

describe('rankSlice realtime updates', () => {
  it('sorts incoming scores and recalculates provisional ranks', () => {
    const initialState = reducer(undefined, { type: '@@init' })
    const state = reducer(
      initialState,
      upsertRankRows({
        scope: 'GLOBAL',
        category: 'COINS',
        items: [
          { playerId: 2, nickname: 'Second', score: 200, rank: 8 },
          { playerId: 1, nickname: 'First', score: 500, rank: 9 },
        ],
      }),
    )

    const rows = state.rankings[rankKey('GLOBAL', 'COINS')]
    expect(rows.map((row) => row.playerId)).toEqual([1, 2])
    expect(rows.map((row) => row.rank)).toEqual([1, 2])
    expect(rows.every((row) => row.provisionalRank)).toBe(true)
  })
})
