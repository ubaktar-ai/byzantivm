-- Byzantivm (US S-corp, Miami) and Demya (Dutch sole proprietorship):
-- per-company country & default currency, USD/EUR only, VAT treatment per document.
-- Run once in Supabase → SQL Editor (safe to run again).

alter table public.companies
  add column if not exists country          text not null default 'NL',
  add column if not exists default_currency text not null default 'EUR';
alter table public.companies drop constraint if exists companies_country_check;
alter table public.companies add constraint companies_country_check check (country in ('NL','US'));
alter table public.companies drop constraint if exists companies_default_currency_check;
alter table public.companies add constraint companies_default_currency_check check (default_currency in ('EUR','USD'));

-- Set the two companies up (only if they still have the initial defaults).
update public.companies set country = 'US', default_currency = 'USD', default_vat = 0, doc_language = 'en'
  where id = 'byzantivm' and country = 'NL' and default_currency = 'EUR';
update public.companies set country = 'NL', default_currency = 'EUR'
  where id = 'demya' and default_currency = 'EUR';

-- Only US dollars and euros.
update public.projects set currency = 'EUR' where currency not in ('EUR','USD');
alter table public.projects drop constraint if exists projects_currency_check;
alter table public.projects add constraint projects_currency_check check (currency in ('EUR','USD'));

-- How VAT / sales tax applies to each quote and invoice.
--   standard        : the document's rate is charged (21%, 9% in NL; sales tax % in the US)
--   reverse_charge  : EU business client outside NL, VAT reverse-charged (0%)
--   outside_eu      : client outside the EU, no Dutch VAT (0%)
--   kor             : Dutch small business scheme (KOR), exempt (0%)
alter table public.quotes   add column if not exists vat_treatment text not null default 'standard';
alter table public.invoices add column if not exists vat_treatment text not null default 'standard';
alter table public.quotes   drop constraint if exists quotes_vat_treatment_check;
alter table public.quotes   add constraint quotes_vat_treatment_check check (vat_treatment in ('standard','reverse_charge','outside_eu','kor'));
alter table public.invoices drop constraint if exists invoices_vat_treatment_check;
alter table public.invoices add constraint invoices_vat_treatment_check check (vat_treatment in ('standard','reverse_charge','outside_eu','kor'));
