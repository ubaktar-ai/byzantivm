-- Files per tab: every uploaded PDF/photo can belong to a part of the order
-- (client inquiry, supplier quote, drawings, money, shipping, other documents)
-- and optionally to one product. Run once in Supabase → SQL Editor (safe to run again).

alter table public.attachments
  add column if not exists kind    text,
  add column if not exists item_id uuid references public.items (id) on delete set null;

alter table public.attachments drop constraint if exists attachments_kind_check;
alter table public.attachments add constraint attachments_kind_check check
  (kind is null or kind in ('inquiry','supplier_quote','drawing','money','shipping','general'));

create index if not exists attachments_item_idx on public.attachments (item_id);
