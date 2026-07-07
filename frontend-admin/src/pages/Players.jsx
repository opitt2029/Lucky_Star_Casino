import PageStub from '../components/PageStub'

export default function Players() {
  return (
    <PageStub
      title="玩家管理"
      description="分頁列表 + 關鍵字搜尋，點列進入玩家詳情（T-051）。"
      apis={['GET /admin/players?page=&size=&keyword=（Spring Data Page 格式）']}
    />
  )
}
