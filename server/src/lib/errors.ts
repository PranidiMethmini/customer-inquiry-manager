import type { ErrorRequestHandler } from 'express';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof URIError && 'status' in error && error.status === 400) {
    response.status(400).json({ error: { code: 'INVALID_ID', message: 'Path must contain valid URL encoding.' } });
    return;
  }
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }) } });
    return;
  }
  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    response.status(415).json({ error: { code: 'UNSUPPORTED_ENCODING', message: 'Use UTF-8 JSON with a supported content encoding.' } });
    return;
  }
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    response.status(type === 'entity.too.large' ? 413 : 400).json({
      error: { code: 'INVALID_JSON', message: type === 'entity.too.large' ? 'Request body is too large.' : 'Request body must be valid JSON.' },
    });
    return;
  }
  console.error('API request failed unexpectedly.');
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unable to complete the request. Please try again.' } });
};
