import * as http from 'http';
import { URL } from 'url';
import { CloudLogger, extractOrCreateTraceContext } from '../observability/telemetry';
import { GlobalHttpExceptionFilter } from '../errors/http-exceptions';

export interface RouteContext {
  method: string;
  pathname: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: any;
  rawBody: string;
  correlationId: string;
  traceparent: string;
  traceId: string;
}

export interface RouteResult {
  statusCode?: number;
  body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult | unknown> | RouteResult | unknown;

interface RegisteredRoute {
  method: string;
  pattern: string;
  segments: string[];
  handler: RouteHandler;
}

/**
 * Lightweight NestJS-compatible HTTP Application wrapper supporting:
 * - Automatic `x-correlation-id` and W3C `traceparent` extraction/injection
 * - Structured JSON request/response logging via `CloudLogger`
 * - Route parameter matching (`/api/v1/products/:id`)
 * - Global exception filtering (`GlobalHttpExceptionFilter`)
 */
export class MicroHttpApplication {
  private readonly routes: RegisteredRoute[] = [];
  private server?: http.Server;

  constructor(
    private readonly serviceName: string,
    private readonly logger: CloudLogger = new CloudLogger(serviceName),
  ) {}

  registerRoute(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', pattern: string, handler: RouteHandler): void {
    const segments = pattern.split('/').filter(Boolean);
    this.routes.push({ method, pattern, segments, handler });
  }

  private matchRoute(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | undefined {
    const reqSegments = pathname.split('/').filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== reqSegments.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i];
        const reqSeg = reqSegments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(reqSeg);
        } else if (seg !== reqSeg) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { handler: route.handler, params };
      }
    }
    return undefined;
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const normalizedHeaders: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }

    const traceCtx = extractOrCreateTraceContext(normalizedHeaders);
    res.setHeader('x-correlation-id', traceCtx.correlationId);
    res.setHeader('traceparent', traceCtx.traceparent);
    res.setHeader('content-type', 'application/json; charset=utf-8');

    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      let body: any = {};
      if (rawBody.trim().length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          res.statusCode = 400;
          res.end(
            JSON.stringify({
              statusCode: 400,
              errorCode: 'INVALID_JSON',
              message: 'Malformed JSON request payload',
              correlationId: traceCtx.correlationId,
              path: pathname,
              timestamp: new Date().toISOString(),
            }),
          );
          return;
        }
      }

      const matched = this.matchRoute(method, pathname);
      if (!matched) {
        res.statusCode = 404;
        res.end(
          JSON.stringify({
            statusCode: 404,
            errorCode: 'ROUTE_NOT_FOUND',
            message: `Cannot ${method} ${pathname}`,
            correlationId: traceCtx.correlationId,
            path: pathname,
            timestamp: new Date().toISOString(),
          }),
        );
        return;
      }

      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const result = await matched.handler({
        method,
        pathname,
        params: matched.params,
        query,
        headers: normalizedHeaders,
        body,
        rawBody,
        correlationId: traceCtx.correlationId,
        traceparent: traceCtx.traceparent,
        traceId: traceCtx.traceId,
      });

      const isWrapped =
        result &&
        typeof result === 'object' &&
        'statusCode' in result &&
        'body' in result &&
        typeof (result as RouteResult).statusCode === 'number';

      const statusCode = isWrapped ? (result as RouteResult).statusCode! : 200;
      const responseBody = isWrapped ? (result as RouteResult).body : result;

      this.logger.log('INFO', `${method} ${pathname} -> ${statusCode}`, {
        correlationId: traceCtx.correlationId,
        traceId: traceCtx.traceId,
        metadata: { method, pathname, statusCode },
      });

      res.statusCode = statusCode;
      res.end(JSON.stringify(responseBody));
    } catch (error) {
      const errorPayload = GlobalHttpExceptionFilter.toErrorResponse(error, {
        correlationId: traceCtx.correlationId,
        path: pathname,
      });
      this.logger.log('ERROR', `${method} ${pathname} failed: ${errorPayload.message}`, {
        correlationId: traceCtx.correlationId,
        traceId: traceCtx.traceId,
        metadata: { statusCode: errorPayload.statusCode, errorCode: errorPayload.errorCode },
      });
      res.statusCode = errorPayload.statusCode;
      res.end(JSON.stringify(errorPayload));
    }
  }

  async listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });
      this.server.on('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        const addr = this.server!.address();
        const boundPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(boundPort);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
