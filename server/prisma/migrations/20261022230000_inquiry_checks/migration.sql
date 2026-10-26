-- Keep basic record invariants even when writes bypass API validation.
-- Do not repair/delete existing rows implicitly: invalid data must be reviewed.
ALTER TABLE "Inquiry"
  ADD CONSTRAINT "Inquiry_required_text_check" CHECK (
    "customerName" ~ '[^[:space:]]' AND
    "subject" ~ '[^[:space:]]' AND
    "description" ~ '[^[:space:]]'
  ),
  ADD CONSTRAINT "Inquiry_contact_check" CHECK (
    COALESCE("email" ~ '[^[:space:]]', false) OR
    COALESCE("phone" ~ '[^[:space:]]', false)
  );
