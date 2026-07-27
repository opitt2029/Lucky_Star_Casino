import { useCallback } from 'react'
import { useDispatch } from 'react-redux'
import { fetchRanks } from '../store/slices/rankSlice'
import { fetchDiamondBalance } from '../store/slices/diamondSlice'
import { fetchWallet } from '../store/slices/walletSlice'

export default function usePostAuthSync() {
  const dispatch = useDispatch()

  return useCallback(() => {
    dispatch(fetchWallet())
    dispatch(fetchDiamondBalance())
    dispatch(fetchRanks())
  }, [dispatch])
}
