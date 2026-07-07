import PageStub from '../components/PageStub'

export default function DiamondCards() {
  return (
    <PageStub
      title="鑽石點數卡"
      description="批次生成序號 + 列表查詢兌換狀態（T-105/T-106）。"
      apis={[
        'POST /admin/diamond/cards（body: { count, faceValue }，最多 1000 張/次）',
        'GET /admin/diamond/cards?page=&size=&status=all|redeemed|unredeemed',
      ]}
    />
  )
}
