-- Euro as default currency (EUR / USD / GBP only), English or Dutch documents, no tax-office fields.
-- Run once in Supabase → SQL Editor (safe to run again).

-- Currency: euro by default; projects in other currencies become euro projects (amounts are not converted).
update public.projects set currency = 'EUR' where currency = 'TRY';
alter table public.projects alter column currency set default 'EUR';
alter table public.projects drop constraint if exists projects_currency_check;
alter table public.projects add constraint projects_currency_check check (currency in ('EUR','USD','GBP'));

-- Document language: English or Dutch only.
update public.quotes    set language = 'en' where language not in ('en','nl');
update public.invoices  set language = 'en' where language not in ('en','nl');
update public.companies set doc_language = 'en' where doc_language not in ('en','nl');

-- Tax-office fields are no longer used.
alter table public.companies drop column if exists tax_office;
alter table public.clients   drop column if exists tax_office;
