export function assertCronAuthorized(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || auth !== `Bearer ${secret}`) {
    throw new Error('unauthorized')
  }
}
