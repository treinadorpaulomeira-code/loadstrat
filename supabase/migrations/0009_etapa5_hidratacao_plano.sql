-- Etapa 5: hidratação diária, meta pessoal de água e plano visto pelo aluno (só rótulos)
create table public.hidratacao (
  aluno_id      uuid not null references public.profiles(id) on delete cascade,
  data          date not null default current_date,
  ml            integer not null default 0 check (ml between 0 and 15000),
  meta_ml       integer check (meta_ml between 500 and 10000),
  atualizado_em timestamptz not null default now(),
  primary key (aluno_id, data)
);
alter table public.hidratacao enable row level security;
create policy hidratacao_sel on public.hidratacao for select to authenticated using (public.pode_ver_aluno(aluno_id));
create policy hidratacao_ins on public.hidratacao for insert to authenticated with check (aluno_id = auth.uid());
create policy hidratacao_upd on public.hidratacao for update to authenticated using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());

alter table public.profiles add column if not exists meta_agua_ml integer check (meta_agua_ml between 500 and 10000);

-- soma atômica (security invoker: RLS vale)
create or replace function public.adicionar_agua(_data date, _ml integer, _meta integer default null)
returns public.hidratacao language plpgsql security invoker set search_path = public as $$
declare r public.hidratacao;
begin
  if abs(_data - current_date) > 1 then raise exception 'data fora do intervalo permitido' using errcode = '22008'; end if;
  if _ml < -2000 or _ml > 3000 then raise exception 'quantidade invalida' using errcode = '22003'; end if;
  insert into public.hidratacao as h (aluno_id, data, ml, meta_ml) values (auth.uid(), _data, greatest(0, _ml), _meta)
  on conflict (aluno_id, data) do update
    set ml = greatest(0, least(15000, h.ml + _ml)), meta_ml = coalesce(excluded.meta_ml, h.meta_ml), atualizado_em = now()
  returning * into r;
  return r;
end $$;
revoke execute on function public.adicionar_agua(date, integer, integer) from public, anon;
grant execute on function public.adicionar_agua(date, integer, integer) to authenticated;

-- o aluno não lê a tabela periodization; recebe só fase, semana e rótulos (nunca UA)
create or replace function public.plano_do_aluno()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.periodization; semanas jsonb; fases jsonb;
begin
  select * into p from public.periodization where aluno_id = auth.uid() and inicio is not null order by criado_em desc limit 1;
  if not found then return null; end if;
  select jsonb_agg(jsonb_build_object('n', s->'n', 'fase', s->'fase', 'rotulo', s->'rotulo', 'descarga', s->'descarga', 'foco', s->'foco_aluno')
                   order by (s->>'n')::int)
    into semanas from jsonb_array_elements(coalesce(p.fases->'semanas', '[]'::jsonb)) s;
  select jsonb_agg(jsonb_build_object('n', f->'n', 'w', f->'w')) into fases from jsonb_array_elements(coalesce(p.fases->'fases', '[]'::jsonb)) f;
  return jsonb_build_object('esporte', p.fases->>'esporte_nome', 'inicio', p.inicio, 'fim', p.fim,
    'semana_atual', floor((current_date - p.inicio) / 7.0)::int + 1,
    'total', jsonb_array_length(coalesce(p.fases->'semanas', '[]'::jsonb)), 'fases', fases, 'semanas', semanas);
end $$;
revoke execute on function public.plano_do_aluno() from public, anon;
grant execute on function public.plano_do_aluno() to authenticated;
