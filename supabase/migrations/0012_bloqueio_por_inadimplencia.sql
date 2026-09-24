-- 0012_bloqueio_por_inadimplencia.sql
-- Regra: passou (vencimento + carência) e a mensalidade continua pendente,
-- o app do aluno trava. O bloqueio é no BANCO, não só na tela: mesmo
-- chamando a API direto ele não lê treino nenhum.
-- O que ele CONTINUA vendo: as cobranças dele, para poder pagar.
-- Saídas: marcar a cobrança como paga, isentar, ou usar
-- subscriptions.liberado_ate para liberar na mão.

create or replace function public.aluno_bloqueado(_aluno uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.charges c
      join public.subscriptions s on s.id = c.subscription_id
     where c.aluno_id = _aluno
       and c.status = 'pendente'
       and s.status = 'ativa'
       and (c.vencimento + s.carencia_dias) <= current_date
       and coalesce(s.liberado_ate, date '1900-01-01') < current_date
  )
  or exists (
    select 1 from public.subscriptions s
     where s.aluno_id = _aluno and s.bloqueio_manual and s.status <> 'encerrada'
  );
$$;
comment on function public.aluno_bloqueado is 'Mensalidade vencida além da carência (ou bloqueio manual) trava o app do aluno.';

create or replace function public.pode_treinar(_aluno uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_treinador_de(_aluno)
      or (_aluno = auth.uid() and not public.aluno_bloqueado(_aluno));
$$;

-- o app do aluno pergunta isto para saber se mostra a tela de pagamento
create or replace function public.meu_acesso()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bloqueado', public.aluno_bloqueado(auth.uid()),
    'em_atraso', (
      select count(*) from public.charges c
       where c.aluno_id = auth.uid() and c.status = 'pendente' and c.vencimento < current_date),
    'a_vencer', (
      select count(*) from public.charges c
       where c.aluno_id = auth.uid() and c.status = 'pendente' and c.vencimento >= current_date),
    'total_devido_centavos', coalesce((
      select sum(c.valor_centavos) from public.charges c
       where c.aluno_id = auth.uid() and c.status = 'pendente'), 0)
  );
$$;
grant execute on function public.meu_acesso() to authenticated;

drop policy if exists workouts_sel on public.workouts;
create policy workouts_sel on public.workouts for select
  using (treinador_id = auth.uid()
      or (aluno_id = auth.uid() and status = 'publicado' and not public.aluno_bloqueado(auth.uid())));

drop policy if exists session_logs_sel on public.session_logs;
create policy session_logs_sel on public.session_logs for select using (public.pode_treinar(aluno_id));
drop policy if exists session_logs_upd on public.session_logs;
create policy session_logs_upd on public.session_logs for update using (public.pode_treinar(aluno_id));
drop policy if exists session_logs_del on public.session_logs;
create policy session_logs_del on public.session_logs for delete using (public.pode_treinar(aluno_id));

drop policy if exists checkins_sel on public.checkins;
create policy checkins_sel on public.checkins for select using (public.pode_ver_aluno(aluno_id));
