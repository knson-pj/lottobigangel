# Stage 2 patch files

## 포함 파일
- `lib/lottotapa-sync.ts` (신규)
- `app/api/cron/sync-draws/route.ts` (교체)
- `app/api/cron/daily-predict/route.ts` (교체)

## 적용 순서
1. `lib/lottotapa-sync.ts`를 새로 추가
2. `app/api/cron/sync-draws/route.ts`를 이 파일로 교체
3. `app/api/cron/daily-predict/route.ts`를 이 파일로 교체
4. GitHub 커밋 후 Vercel 재배포

## 배포 후 테스트
- `GET /api/cron/sync-draws` (Vercel cron 또는 수동 호출)
- `GET /api/cron/daily-predict`
- `GET /api/predictions/latest`

## 참고
- 이 단계는 로또타파 최신 확정 회차를 가져와 `lotto_draws`, `lotto_draw_features`에 upsert 합니다.
- 실제 딥러닝 추론 연결은 아직 `lib/predict.ts` 자리에 다음 단계에서 붙이면 됩니다.
