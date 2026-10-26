import { z } from 'zod';
import { ApiError } from './errors.js';

export function parseInput<T extends z.ZodType>(schema: T, value: unknown, message: string): z.output<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) fields[String(issue.path[0] ?? 'form')] ??= issue.message;
  throw new ApiError(400, 'VALIDATION_ERROR', message, fields);
}
