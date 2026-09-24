-- 0011_gestao_planos_agenda_financeiro.sql
-- GESTÃO DO TREINADOR: planos, assinaturas, cobranças,
-- entradas/saídas, horários fixos e agenda com presença.
-- Dinheiro sempre em centavos (int), para não ter erro de float.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  nome text not null,
  modalidade text not null check (modalidade in ('online','presencial')),
  valor_centavos int not null check (valor_centavos >= 0),
  periodicidade text not null default 'mensal'
    check (periodicidade in ('mensal','trimestral','semestral','anual','avulso')),
  sessoes_semana int check (sessoes_semana between 0 and 14),
  descricao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.plans is 'Planos que o treinador vende, separados por modalidade (online/presencial).';

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  inicio date not null default current_date,
  dia_vencimento int not null default 5 check (dia_vencimento between 1 and 28),
  carencia_dias int not null default 1 check (carencia_dias between 0 and 60),
  status text not null default 'ativa' check (status in ('ativa','pausada','encerrada')),
  bloqueio_manual boolean not null default false,
  liberado_ate date,
  obs text,
  criado_em timestamptz not null default now()
);
comment on column public.subscriptions.carencia_dias is 'Dias após o vencimento antes de travar o app do aluno.';
comment on column public.subscriptions.liberado_ate is 'Liberação manual: enquanto esta data for futura, o aluno não é bloqueado mesmo em atraso.';
create index if not exists subscriptions_aluno on public.subscriptions(aluno_id);

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete set null,
  modalidade text not null check (modalidade in ('online','presencial')),
  competencia date not null,
  vencimento date not null,
  valor_centavos int not null check (valor_centavos >= 0),
  status text not null default 'pendente' check (status in ('pendente','pago','cancelado','isento')),
  pago_em timestamptz,
  metodo text,
  mp_payment_id text,
  mp_link text,
  mp_pix_copia text,
  mp_pix_qr text,
  mp_expira_em timestamptz,
  obs text,
  criado_em timestamptz not null default now()
);
comment on table public.charges is 'Mensalidades. Uma linha por competência de cada assinatura.';
create unique index if not exists charges_unica_por_competencia on public.charges(subscription_id, competencia);
create index if not exists charges_aluno_status on public.charges(aluno_id, status);
create unique index if not exists charges_mp_payment on public.charges(mp_payment_id) where mp_payment_id is not null;

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check (tipo in ('entrada','saida')),
  modalidade text check (modalidade in ('online','presencial')),
  categoria text,
  descricao text not null,
  aluno_id uuid references public.profiles(id) on delete set null,
  data date not null default current_date,
  valor_centavos int not null check (valor_centavos >= 0),
  criado_em timestamptz not null default now()
);
comment on table public.finance_entries is 'Lançamentos que não são mensalidade: avaliações, diárias, e as despesas.';
create index if not exists finance_entries_data on public.finance_entries(treinador_id, data);

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id uuid not null references public.profiles(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  hora time not null,
  duracao_min int not null default 60 check (duracao_min between 10 and 300),
  modalidade text not null default 'presencial' check (modalidade in ('online','presencial')),
  local text,
  inicio date not null default current_date,
  fim date,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
comment on table public.schedule_slots is 'Horário fixo da semana (0=domingo). A agenda monta os dias a partir daqui.';

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id uuid not null references public.profiles(id) on delete cascade,
  slot_id uuid references public.schedule_slots(id) on delete set null,
  data date not null,
  hora time not null,
  duracao_min int not null default 60 check (duracao_min between 10 and 300),
  modalidade text not null default 'presencial' check (modalidade in ('online','presencial')),
  local text,
  status text not null default 'agendado'
    check (status in ('agendado','presente','falta','cancelado','remarcado')),
  obs text,
  session_id uuid references public.session_logs(id) on delete set null,
  criado_em timestamptz not null default now()
);
comment on table public.appointments is 'O que realmente aconteceu em cada horário: presença, falta, cancelamento ou remarcação.';
create unique index if not exists appointments_slot_dia on public.appointments(slot_id, data) where slot_id is not null;
create index if not exists appointments_data on public.appointments(treinador_id, data);

alter table public.plans            enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.charges          enable row level security;
alter table public.finance_entries  enable row level security;
alter table public.schedule_slots   enable row level security;
alter table public.appointments     enable row level security;

create policy plans_sel on public.plans for select using (treinador_id = auth.uid());
create policy plans_ins on public.plans for insert with check (treinador_id = auth.uid() and meu_papel() = 'treinador');
create policy plans_upd on public.plans for update using (treinador_id = auth.uid());
create policy plans_del on public.plans for delete using (treinador_id = auth.uid());

create policy fin_sel on public.finance_entries for select using (treinador_id = auth.uid());
create policy fin_ins on public.finance_entries for insert with check (treinador_id = auth.uid() and meu_papel() = 'treinador');
create policy fin_upd on public.finance_entries for update using (treinador_id = auth.uid());
create policy fin_del on public.finance_entries for delete using (treinador_id = auth.uid());

create policy slots_sel on public.schedule_slots for select using (treinador_id = auth.uid());
create policy slots_ins on public.schedule_slots for insert with check (treinador_id = auth.uid() and eh_treinador_de(aluno_id));
create policy slots_upd on public.schedule_slots for update using (treinador_id = auth.uid());
create policy slots_del on public.schedule_slots for delete using (treinador_id = auth.uid());

create policy ap_sel on public.appointments for select using (treinador_id = auth.uid());
create policy ap_ins on public.appointments for insert with check (treinador_id = auth.uid() and eh_treinador_de(aluno_id));
create policy ap_upd on public.appointments for update using (treinador_id = auth.uid());
create policy ap_del on public.appointments for delete using (treinador_id = auth.uid());

-- o aluno enxerga a assinatura e as cobranças dele (precisa, para pagar), mas não escreve
create policy subs_sel on public.subscriptions for select using (treinador_id = auth.uid() or aluno_id = auth.uid());
create policy subs_ins on public.subscriptions for insert with check (treinador_id = auth.uid() and eh_treinador_de(aluno_id));
create policy subs_upd on public.subscriptions for update using (treinador_id = auth.uid());
create policy subs_del on public.subscriptions for delete using (treinador_id = auth.uid());

create policy charges_sel on public.charges for select using (treinador_id = auth.uid() or aluno_id = auth.uid());
create policy charges_ins on public.charges for insert with check (treinador_id = auth.uid() and eh_treinador_de(aluno_id));
create policy charges_upd on public.charges for update using (treinador_id = auth.uid());
create policy charges_del on public.charges for delete using (treinador_id = auth.uid());
