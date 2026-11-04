export const APP_CONFIG = 'APP_CONFIG';

export interface AppConfig {
  env: string;
  port: number;
  swaggerEnabled: boolean;
  chaosFailOnce: boolean;
  internalApiKey: string;
  callbackSecrets: Record<string, string>;
  db: { host: string; port: number; user: string; password: string; database: string };
  dbTls: { enabled: boolean; caPath: string };
  providers: {
    mock: boolean;
    callbackBase: string;
    mtn: { baseUrl: string; apiUser: string; apiKey: string; subscriptionKey: string; targetEnv: string };
    airtel: { baseUrl: string; clientId: string; clientSecret: string; country: string };
  };
  worker: { intervalMs: number; pendingTimeoutMin: number };
}

export function loadConfig(): AppConfig {
  const required = [
    'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
    'INTERNAL_API_KEY', 'MTN_CALLBACK_SECRET', 'AIRTEL_CALLBACK_SECRET',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    // fail fast: never run half-configured
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  const e = (k: string, d = '') => process.env[k] ?? d;
  const env = e('NODE_ENV', 'development');

  return {
    env,
    port: Number(e('PORT', '3000')),
    swaggerEnabled: e('SWAGGER_ENABLED', env === 'production' ? 'false' : 'true') === 'true',
    chaosFailOnce: e('CHAOS_FAIL_ONCE') === '1' && env !== 'production',
    internalApiKey: e('INTERNAL_API_KEY'),
    callbackSecrets: { MTN: e('MTN_CALLBACK_SECRET'), AIRTEL: e('AIRTEL_CALLBACK_SECRET') },
    db: {
      host: e('DB_HOST'),
      port: Number(e('DB_PORT', '3306')),
      user: e('DB_USER'),
      password: e('DB_PASSWORD'),
      database: e('DB_NAME'),
    },
    dbTls: { enabled: e('DB_SSL') === 'true', caPath: e('DB_SSL_CA') },
    providers: {
      mock: e('PROVIDER_MOCK', 'true') === 'true',
      callbackBase: e('PUBLIC_CALLBACK_BASE_URL'),
      mtn: {
        baseUrl: e('MTN_BASE_URL'), apiUser: e('MTN_API_USER'), apiKey: e('MTN_API_KEY'),
        subscriptionKey: e('MTN_SUBSCRIPTION_KEY'), targetEnv: e('MTN_TARGET_ENV', 'sandbox'),
      },
      airtel: {
        baseUrl: e('AIRTEL_BASE_URL'), clientId: e('AIRTEL_CLIENT_ID'),
        clientSecret: e('AIRTEL_CLIENT_SECRET'), country: e('AIRTEL_COUNTRY', 'RW'),
      },
    },
    worker: {
      intervalMs: Number(e('WORKER_INTERVAL_MS', '60000')),
      pendingTimeoutMin: Number(e('PENDING_TIMEOUT_MIN', '5')),
    },
  };
}