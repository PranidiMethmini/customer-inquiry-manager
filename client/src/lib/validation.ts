import { z } from 'zod';

const text = (name: string, limit: number) => z.string().trim().min(1, `Enter ${name}.`).max(limit, `Use ${limit.toLocaleString()} characters or fewer.`)
  .refine(value => !value.includes('\u0000'), 'Remove NUL characters.');
const blankToNull = (value: unknown) => typeof value === 'string' && value.trim() === '' ? null : value;
export const inquiryFormSchema = z.object({
  customerName: text('the customer name', 120),
  email: z.preprocess(blankToNull, z.string().trim().max(254, 'Use 254 characters or fewer.').email('Enter a valid email address.').toLowerCase().nullable()),
  phone: z.preprocess(blankToNull, z.string().trim().max(40, 'Use 40 characters or fewer.').refine(value => {
    const digits = value.replace(/\D/g, '');
    return /^\+?[0-9() .-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }, 'Enter a phone number with 7–15 digits and standard formatting.').nullable()),
  subject: text('a subject', 200), description: text('a description', 5000),
}).refine(value => value.email !== null || value.phone !== null, { path: ['email'], message: 'Enter an email address or phone number.' });

export const signInSchema = z.object({
  email: z.string().trim().max(254, 'Use 254 characters or fewer.').email('Enter a valid email address.').toLowerCase(),
  password: z.string().min(1, 'Enter your password.').max(256, 'Use 256 characters or fewer.'),
});

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0])] ??= issue.message;
  return errors;
}
