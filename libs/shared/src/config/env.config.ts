export interface BaseServiceConfig {
  serviceName: string;
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  port: number;
  databaseUrl: string;
  gcpProjectId: string;
  logLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR';
}

/**
 * Loads and validates environment variables with zero hardcoded credentials.
 * Throws an explicit configuration error if required environment variables (such as DATABASE_URL)
 * are missing in staging/production environments.
 */
export function loadBaseServiceConfig(
  serviceName: string,
  defaultPort: number,
  env: Record<string, string | undefined> = process.env,
): BaseServiceConfig {
  const nodeEnv = (env.NODE_ENV as BaseServiceConfig['nodeEnv']) || 'development';
  const rawPort = env.PORT ? Number(env.PORT) : defaultPort;

  if (!Number.isInteger(rawPort) || rawPort <= 0 || rawPort > 65535) {
    throw new Error(`[${serviceName}] Invalid PORT environment variable: ${env.PORT}`);
  }

  const databaseUrl = env.DATABASE_URL || '';
  if ((nodeEnv === 'production' || nodeEnv === 'staging') && !databaseUrl) {
    throw new Error(
      `[${serviceName}] Missing required DATABASE_URL environment variable in ${nodeEnv} mode`,
    );
  }

  const logLevel =
    (env.LOG_LEVEL as BaseServiceConfig['logLevel']) ||
    (nodeEnv === 'production' ? 'INFO' : 'DEBUG');

  return {
    serviceName,
    nodeEnv,
    port: rawPort,
    databaseUrl: databaseUrl || `memory://${serviceName}-test-db`,
    gcpProjectId: env.GCP_PROJECT_ID || 'cloudmart-local',
    logLevel,
  };
}
