import posthog from 'posthog-js';

const key = window.__POSTHOG_KEY__ || '';
const host = window.__POSTHOG_HOST__ || 'https://us.i.posthog.com';

export function initPostHog() {
  if (!key) return;
  posthog.init(key, {
    api_host: host,
    person_profiles: 'identified_only',
    capture_pageview: false,
    autocapture: true,
    session_recording: {
      maskAllInputs: false,
      maskInputOptions: { password: true },
    },
  });

  const userName = window.__USER_NAME__;
  if (userName) {
    posthog.identify(userName, { name: userName, source: 'webchat' });
  }
}

export { posthog };
