import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requireAuth } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import { parseInput } from '../lib/validation.js';
import { createInquiryInput, inquirySearchInput, updateStatusInput } from '../lib/inquiry-validation.js';
import { createInquiry, getInquiry, listInquiries, updateInquiryStatus } from '../services/inquiries.js';

function inquiryId(value: unknown): string {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'INVALID_ID', 'Inquiry ID must be a valid UUID.');
  return parsed.data.toLowerCase();
}

export function inquiriesRouter(prisma: PrismaClient) {
  const router = Router();
  router.use(requireAuth(prisma));

  router.post('/', async (request, response) => {
    const input = parseInput(createInquiryInput, request.body, 'Check the inquiry details.');
    const result = await createInquiry(prisma, request.staff!.id, input);
    if (result.created) response.location(`/api/inquiries/${result.inquiry.id}`);
    response.status(result.created ? 201 : 200).json({ inquiry: result.inquiry });
  });
  router.get('/', async (request, response) => {
    const { search } = parseInput(inquirySearchInput, request.query, 'Enter a search term of at most 200 characters.');
    response.json({ inquiries: await listInquiries(prisma, request.staff!.id, search) });
  });
  router.get('/:id', async (request, response) => {
    response.json({ inquiry: await getInquiry(prisma, request.staff!.id, inquiryId(request.params.id)) });
  });
  router.patch('/:id/status', async (request, response) => {
    const id = inquiryId(request.params.id);
    const input = parseInput(updateStatusInput, request.body, 'Provide expectedStatus and the target status.');
    response.json({ inquiry: await updateInquiryStatus(prisma, request.staff!.id, id, input) });
  });
  return router;
}
