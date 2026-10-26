-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "customerName" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "submissionKey" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Inquiry_createdById_createdAt_idx" ON "Inquiry"("createdById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_createdById_submissionKey_key" ON "Inquiry"("createdById", "submissionKey");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
