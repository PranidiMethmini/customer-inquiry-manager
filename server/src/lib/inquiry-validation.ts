import { z } from 'zod';

const storedText = (limit: number, requiredMessage: string) => z.string().trim()
  .min(1, requiredMessage).max(limit).refine(value => !value.includes('\u0000'), 'Remove NUL characters.');

function blankContactToNull(value: unknown) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ? null : value;
}

const email = z.preprocess(blankContactToNull,
  z.string().trim().max(254).email('Enter a valid email address.').toLowerCase().nullable());
const phone = z.preprocess(blankContactToNull,
  z.string().trim().max(40).refine(value => {
    const digits = value.replace(/\D/g, '');
    return /^\+?[0-9() .-]+$/.test(value) && digits.length >= 7 && digits.length <= 15;
  }, 'Enter a phone number with 7 to 15 digits; spaces, +, parentheses, dots and hyphens are allowed.').nullable());

export const createInquiryInput = z.object({
  customerName: storedText(120, 'Enter the customer name.'),
  email,
  phone,
  subject: storedText(200, 'Enter a subject.'),
  description: storedText(5000, 'Enter a description.'),
  submissionKey: z.uuid('submissionKey must be a UUID.').toLowerCase(),
}).strict().refine(value => value.email !== null || value.phone !== null, {
  message: 'Provide at least one valid contact method: email or phone.', path: ['email'],
});

const status = z.enum(['NEW', 'IN_PROGRESS', 'RESOLVED']);
export const updateStatusInput = z.object({ expectedStatus: status, status }).strict();
export const inquirySearchInput = z.object({ search: z.string().trim().max(200)
  .refine(value => !value.includes('\u0000'), 'Remove NUL characters.').default('') }).strict();
export type CreateInquiryInput = z.output<typeof createInquiryInput>;
export type UpdateStatusInput = z.output<typeof updateStatusInput>;
