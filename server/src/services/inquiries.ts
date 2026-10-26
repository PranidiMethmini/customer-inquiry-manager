import { Prisma, type PrismaClient, type InquiryStatus } from '../generated/prisma/client.js';
import { ApiError } from '../lib/errors.js';
import type { CreateInquiryInput, UpdateStatusInput } from '../lib/inquiry-validation.js';

const detailFields = {
  id: true, customerName: true, email: true, phone: true, subject: true,
  description: true, status: true, createdAt: true, updatedAt: true,
} satisfies Prisma.InquirySelect;

const transitions: Record<InquiryStatus, readonly InquiryStatus[]> = {
  NEW: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED'], RESOLVED: ['IN_PROGRESS'],
};
const notFound = () => new ApiError(404, 'INQUIRY_NOT_FOUND', 'Inquiry not found.');

export async function createInquiry(prisma: PrismaClient, createdById: string, input: CreateInquiryInput) {
  try {
    const inquiry = await prisma.inquiry.create({
      data: { ...input, createdById, status: 'NEW' }, select: detailFields,
    });
    return { inquiry, created: true };
  } catch (error) {
    // Let PostgreSQL arbitrate simultaneous submissions; no check-then-insert race.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await prisma.inquiry.findUnique({
      where: { createdById_submissionKey: { createdById, submissionKey: input.submissionKey } },
      select: detailFields,
    });
    if (!existing) throw error;
    // Status and timestamps can change after creation and are deliberately excluded.
    const sameFields = existing.customerName === input.customerName && existing.email === input.email &&
      existing.phone === input.phone && existing.subject === input.subject && existing.description === input.description;
    if (!sameFields) throw new ApiError(409, 'SUBMISSION_KEY_CONFLICT', 'This submission key was already used for different inquiry details.');
    return { inquiry: existing, created: false };
  }
}

export function listInquiries(prisma: PrismaClient, createdById: string, search: string) {
  // Prisma uses LIKE for contains; escape wildcard characters for literal search.
  const contains = search.replace(/[\\%_]/g, character => `\\${character}`);
  return prisma.inquiry.findMany({
    where: {
      createdById,
      ...(search && { OR: [
        { customerName: { contains, mode: 'insensitive' } },
        { subject: { contains, mode: 'insensitive' } },
      ] }),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, customerName: true, subject: true, status: true, createdAt: true, updatedAt: true },
  });
}

export async function getInquiry(prisma: PrismaClient, createdById: string, id: string) {
  const inquiry = await prisma.inquiry.findFirst({ where: { id, createdById }, select: detailFields });
  if (!inquiry) throw notFound();
  return inquiry;
}

export async function updateInquiryStatus(prisma: PrismaClient, createdById: string, id: string, input: UpdateStatusInput) {
  const { expectedStatus, status } = input;
  if (!transitions[expectedStatus].includes(status)) {
    // Preserve the identical 404 for missing and other staff's records.
    const accessible = await prisma.inquiry.findFirst({ where: { id, createdById }, select: { id: true } });
    if (!accessible) throw notFound();
    throw new ApiError(409, 'INVALID_STATUS_TRANSITION', `Cannot change status from ${expectedStatus} to ${status}.`);
  }
  // One conditional UPDATE ... RETURNING: the status comparison and write are atomic.
  const [updated] = await prisma.inquiry.updateManyAndReturn({
    where: { id, createdById, status: expectedStatus }, data: { status }, select: detailFields,
  });
  if (updated) return updated;
  const accessible = await prisma.inquiry.findFirst({ where: { id, createdById }, select: { id: true } });
  if (!accessible) throw notFound();
  throw new ApiError(409, 'STALE_STATUS', 'This inquiry status has changed. Refresh the inquiry before trying again.');
}
