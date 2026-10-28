import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN
const configuredSampleRate = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.05')
const tracesSampleRate =
  Number.isFinite(configuredSampleRate) && configuredSampleRate >= 0 && configuredSampleRate <= 1
    ? configuredSampleRate
    : 0.05

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate,
  })
}
