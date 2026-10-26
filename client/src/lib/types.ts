export interface Staff { id: string; email: string }
export type Status = 'NEW' | 'IN_PROGRESS' | 'RESOLVED';
export interface InquirySummary {
  id: string; customerName: string; subject: string; status: Status; createdAt: string; updatedAt: string;
}
export interface Inquiry extends InquirySummary { email: string | null; phone: string | null; description: string }
