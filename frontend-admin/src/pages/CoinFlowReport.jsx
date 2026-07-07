import PageStub from '../components/PageStub'

export default function CoinFlowReport() {
  return (
    <PageStub
      title="星幣流通量報表"
      description="依日/週/月維度統計發放、消耗與淨流通（T-052）。"
      apis={['GET /admin/reports/coin-flow?dimension=day|week|month&from=YYYY-MM-DD&to=YYYY-MM-DD']}
    />
  )
}
