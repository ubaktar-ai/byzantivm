-- Step 5: printable quotes & invoices.
-- Run once in Supabase → SQL Editor (safe to run again).

-- Company details printed on documents
alter table public.companies
  add column if not exists legal_name    text not null default '',
  add column if not exists address       text not null default '',
  add column if not exists email         text not null default '',
  add column if not exists phone         text not null default '',
  add column if not exists website       text not null default '',
  add column if not exists tax_id        text not null default '',   -- VAT number (BTW-id)
  add column if not exists registration  text not null default '',   -- Chamber of Commerce (KvK) number
  add column if not exists bank_name     text not null default '',
  add column if not exists iban          text not null default '',
  add column if not exists swift         text not null default '',
  add column if not exists default_vat   numeric(5,2) not null default 0,
  add column if not exists doc_language  text not null default 'en',
  add column if not exists payment_terms text not null default '',
  add column if not exists logo_path     text not null default '';

-- Client tax details (needed on business invoices)
alter table public.clients
  add column if not exists tax_id     text not null default '';

-- VAT and language per document (amounts stay net/excl. VAT)
alter table public.quotes
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists language text not null default 'en';
alter table public.invoices
  add column if not exists vat_rate numeric(5,2) not null default 0,
  add column if not exists language text not null default 'en';
