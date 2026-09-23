-- Correções encontradas no linter do Supabase e na auditoria de RLS.
-- (aplicadas no projeto como endurecer_funcoes + corrige_escalada_de_privilegio)

alter function public.touch_atualizado_em() set search_path = '';

-- toda função nasce com EXECUTE para PUBLIC; revogar só de anon não bastava
revoke execute on function public.eh_treinador_de(uuid) from public, anon;
revoke execute on function public.meu_papel()          from public, anon;
revoke execute on function public.pode_ver_aluno(uuid) from public, anon;
grant  execute on function public.eh_treinador_de(uuid) to authenticated;
grant  execute on function public.meu_papel()           to authenticated;
grant  execute on function public.pode_ver_aluno(uuid)  to authenticated;
revoke execute on function public.handle_new_user()    from public, anon, authenticated;

-- FURO: a política de periodização só exigia "treinador_id = eu";
-- um aluno podia se declarar o próprio treinador e inserir/ler.
drop policy periodization_all on public.periodization;
create policy periodization_sel on public.periodization for select to authenticated
  using (treinador_id = auth.uid() and public.meu_papel()='treinador');
create policy periodization_ins on public.periodization for insert to authenticated
  with check (treinador_id = auth.uid() and public.meu_papel()='treinador'
              and public.eh_treinador_de(aluno_id));
create policy periodization_upd on public.periodization for update to authenticated
  using (treinador_id = auth.uid() and public.meu_papel()='treinador')
  with check (treinador_id = auth.uid() and public.eh_treinador_de(aluno_id));
create policy periodization_del on public.periodization for delete to authenticated
  using (treinador_id = auth.uid() and public.meu_papel()='treinador');

-- FURO: o aluno podia trocar o próprio papel para treinador pela API
-- e, a partir daí, se vincular a outros alunos e ler os dados deles.
create or replace function public.trava_papel()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.papel is distinct from old.papel then
    raise exception 'o papel do usuario nao pode ser alterado pela API' using errcode='42501';
  end if;
  return new;
end; $$;
revoke execute on function public.trava_papel() from public, anon, authenticated;
create trigger profiles_trava_papel before update on public.profiles
  for each row when (current_user in ('authenticated','anon'))
  execute function public.trava_papel();

-- FURO: o papel vinha do metadata enviado pelo cliente no cadastro.
-- Agora todo cadastro nasce aluno; treinador só é promovido no banco.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, papel, nome)
  values (new.id, 'aluno',
          coalesce(new.raw_user_meta_data->>'nome', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
