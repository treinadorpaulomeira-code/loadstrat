-- 0013_gerar_cobrancas_e_guarda_do_plano.sql
-- 1) a periodização também é conteúdo pago: some quando o aluno está bloqueado.
-- 2) gerar_cobrancas: cria (ou completa) as mensalidades de uma assinatura.
--    É idempotente — rodar de novo não duplica nada.

create or replace function public.plano_do_aluno()
returns jsonb
language plpgsql stable security definer set search_path = public as $function$
declare p public.periodization; semanas jsonb; fases jsonb;
begin
  if public.aluno_bloqueado(auth.uid()) then return null; end if;

  select * into p from public.periodization
   where aluno_id = auth.uid() and inicio is not null
   order by criado_em desc limit 1;
  if not found then return null; end if;

  select jsonb_agg(jsonb_build_object('n', s->'n', 'fase', s->'fase', 'rotulo', s->'rotulo',
                                      'descarga', s->'descarga', 'foco', s->'foco_aluno')
                   order by (s->>'n')::int)
    into semanas from jsonb_array_elements(coalesce(p.fases->'semanas', '[]'::jsonb)) s;
  select jsonb_agg(jsonb_build_object('n', f->'n', 'w', f->'w'))
    into fases from jsonb_array_elements(coalesce(p.fases->'fases', '[]'::jsonb)) f;

  return jsonb_build_object(
    'esporte', p.fases->>'esporte_nome',
    'inicio', p.inicio, 'fim', p.fim,
    'semana_atual', floor((current_date - p.inicio) / 7.0)::int + 1,
    'total', jsonb_array_length(coalesce(p.fases->'semanas', '[]'::jsonb)),
    'fases', fases, 'semanas', semanas);
end $function$;

create or replace function public.gerar_cobrancas(_subscription uuid, _ate date default null)
returns int
language plpgsql security definer set search_path = public as $function$
declare
  s public.subscriptions; pl public.plans;
  passo interval; comp date; limite date; venc date; criadas int := 0;
begin
  select * into s from public.subscriptions where id = _subscription;
  if not found then raise exception 'assinatura não encontrada'; end if;
  if s.treinador_id <> auth.uid() then
    raise exception 'só o treinador da assinatura pode gerar cobranças' using errcode = '42501';
  end if;
  select * into pl from public.plans where id = s.plan_id;

  passo := case pl.periodicidade
             when 'mensal' then interval '1 month'
             when 'trimestral' then interval '3 months'
             when 'semestral' then interval '6 months'
             when 'anual' then interval '12 months'
             else interval '1 month' end;

  limite := coalesce(_ate, (current_date + interval '1 month')::date);
  comp := date_trunc('month', s.inicio)::date;

  while comp <= limite loop
    venc := make_date(extract(year from comp)::int, extract(month from comp)::int, s.dia_vencimento);
    insert into public.charges (treinador_id, aluno_id, subscription_id, plan_id, modalidade,
                                competencia, vencimento, valor_centavos)
    values (s.treinador_id, s.aluno_id, s.id, pl.id, pl.modalidade, comp, venc, pl.valor_centavos)
    on conflict (subscription_id, competencia) do nothing;
    if found then criadas := criadas + 1; end if;
    if pl.periodicidade = 'avulso' then exit; end if;
    comp := (comp + passo)::date;
  end loop;
  return criadas;
end $function$;
grant execute on function public.gerar_cobrancas(uuid, date) to authenticated;
