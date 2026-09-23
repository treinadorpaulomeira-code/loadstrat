-- Aplicado no projeto como: vinculo_so_pelo_servidor, aluno_enxerga_o_do_seu_treinador, ondulacao_semanal
drop policy if exists students_ins on public.students; -- vinculo nasce so na edge function criar-aluno

create or replace function public.meu_treinador_e(_quem uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.students s
    where s.aluno_id = auth.uid() and s.treinador_id = _quem and s.ativo);
$$;
revoke execute on function public.meu_treinador_e(uuid) from public, anon;
grant  execute on function public.meu_treinador_e(uuid) to authenticated;

drop policy exercises_sel on public.exercises;
create policy exercises_sel on public.exercises for select to authenticated
  using (owner_id is null or owner_id = auth.uid()
         or public.eh_treinador_de(owner_id) or public.meu_treinador_e(owner_id));
drop policy profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or public.eh_treinador_de(id) or public.meu_treinador_e(id));

-- ondulacao semanal: avanca a cada N sessoes finalizadas
alter table public.workouts
  add column semanas smallint not null default 1 check (semanas between 1 and 24),
  add column sessoes_por_semana smallint not null default 1 check (sessoes_por_semana between 1 and 14);
alter table public.session_logs add column semana smallint check (semana between 1 and 24);

create or replace function public.semana_atual(_workout uuid)
returns smallint language sql stable security invoker set search_path = public as $$
  select least(w.semanas, (floor((select count(*) from public.session_logs s
    where s.workout_id = w.id and s.finalizada)::numeric / greatest(w.sessoes_por_semana,1)) + 1)::int)::smallint
  from public.workouts w where w.id = _workout;
$$;
revoke execute on function public.semana_atual(uuid) from public, anon;
grant  execute on function public.semana_atual(uuid) to authenticated;
