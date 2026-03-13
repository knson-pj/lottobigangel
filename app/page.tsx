export default function HomePage() {
  return (
    <main style={{ padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>Lotto Big Angel</h1>
      <p>온라인 운영용 1차 스캐폴드가 연결된 상태입니다.</p>
      <ul>
        <li>/api/predictions/latest</li>
        <li>/api/predict</li>
        <li>/api/cron/sync-draws</li>
        <li>/api/cron/daily-predict</li>
        <li>/api/admin/backtest</li>
      </ul>
    </main>
  )
}
