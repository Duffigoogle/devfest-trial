export interface StructuredLogEntry {
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  service: string;
  correlationId?: string;
  'logging.googleapis.com/trace'?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Google Cloud Operations Suite (Cloud Logging & Cloud Trace) compatible structured logger.
 */
export class CloudLogger {
  constructor(
    private readonly serviceName: string,
    private readonly gcpProjectId: string = process.env.GCP_PROJECT_ID || 'cloudmart-local',
  ) {}

  log(
    severity: StructuredLogEntry['severity'],
    message: string,
    context?: { correlationId?: string; traceId?: string; metadata?: Record<string, unknown> },
  ): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      severity,
      message,
      service: this.serviceName,
      correlationId: context?.correlationId,
      ...(context?.traceId
        ? {
            'logging.googleapis.com/trace': `projects/${this.gcpProjectId}/traces/${context.traceId}`,
          }
        : {}),
      timestamp: new Date().toISOString(),
      metadata: context?.metadata,
    };
    return entry;
  }
}

/**
 * W3C Trace Context generator/parser for propagating traces across HTTP, gRPC, and Cloud Pub/Sub.
 */
export function extractOrCreateTraceContext(headers: Record<string, string | undefined>): {
  correlationId: string;
  traceparent: string;
  traceId: string;
} {
  const incomingTraceparent = headers['traceparent'];
  const incomingCorrelationId = headers['x-correlation-id'];

  if (incomingTraceparent && /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/.test(incomingTraceparent)) {
    const traceId = incomingTraceparent.split('-')[1];
    return {
      correlationId: incomingCorrelationId || traceId,
      traceparent: incomingTraceparent,
      traceId,
    };
  }

  const randomHex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const traceId = randomHex(32);
  const spanId = randomHex(16);
  const traceparent = `00-${traceId}-${spanId}-01`;

  return {
    correlationId: incomingCorrelationId || traceId,
    traceparent,
    traceId,
  };
}
