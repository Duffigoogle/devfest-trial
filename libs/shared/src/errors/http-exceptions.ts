export interface ErrorResponsePayload {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: string[];
  correlationId: string;
  path: string;
  timestamp: string;
}

export class HttpException extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string,
    public readonly details?: string[],
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class BadRequestException extends HttpException {
  constructor(message: string, details?: string[]) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string) {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string) {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictException extends HttpException {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message: string, details?: string[]) {
    super(422, 'UNPROCESSABLE_ENTITY', message, details);
  }
}

export class GlobalHttpExceptionFilter {
  static toErrorResponse(
    error: unknown,
    context: { correlationId: string; path: string },
  ): ErrorResponsePayload {
    const timestamp = new Date().toISOString();
    if (error instanceof HttpException) {
      return {
        statusCode: error.statusCode,
        errorCode: error.errorCode,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        correlationId: context.correlationId,
        path: context.path,
        timestamp,
      };
    }

    return {
      statusCode: 500,
      errorCode: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Unexpected internal server error',
      correlationId: context.correlationId,
      path: context.path,
      timestamp,
    };
  }
}
