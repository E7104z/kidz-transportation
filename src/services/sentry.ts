/**
 * Sentry SDK initialisation for KIDZ Transportation.
 * Called once from main.tsx BEFORE rendering the React tree.
 *
 * Set VITE_SENTRY_DSN in your .env to enable error reporting.
 * In local dev without a DSN this is a no-op.
 */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  // Lazy-load Sentry to avoid adding it to the initial bundle when not needed
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment:       import.meta.env.MODE,
    release:           import.meta.env.VITE_APP_VERSION ?? 'unknown',
    tracesSampleRate:  import.meta.env.PROD ? 0.1 : 1.0,
    replaysSessionSampleRate:  0.0,
    replaysOnErrorSampleRate:  import.meta.env.PROD ? 1.0 : 0.0,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    beforeSend(event) {
      // Strip PII — remove user email from breadcrumbs
      if (event.user) delete event.user.email;
      return event;
    },
  });
}
