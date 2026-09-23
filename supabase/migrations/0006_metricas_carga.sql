-- Etapa 4: metricas de carga (so o treinador do aluno enxerga)
-- carga interna = PSE x minutos; dias sem treino contam como 0

create index if not exists workout_sets_ex_sessao_idx on public.workout_sets (exercise_id, session_id);

CREATE OR REPLACE FUNCTION public.carga_diaria(_aluno uuid, _de date, _ate date)
 RETURNS TABLE(dia date, carga numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select d::date as dia,
         coalesce((select sum(s.pse * s.duracao_min) from public.session_logs s
                    where s.aluno_id = _aluno and s.finalizada and s.data = d::date
                      and s.pse is not null and s.duracao_min is not null), 0)
       + coalesce((select sum(e.pse * e.duracao_min) from public.extra_sessions e
                    where e.aluno_id = _aluno and e.data = d::date
                      and e.pse is not null and e.duracao_min is not null), 0) as carga
  from generate_series(_de, _ate, interval '1 day') d
  where public.eh_treinador_de(_aluno);  -- aluno chamando para si mesmo recebe vazio
$function$;

CREATE OR REPLACE FUNCTION public.metricas_carga(_aluno uuid, _ate date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_primeiro date;
  v_atual numeric[];
  v_soma numeric; v_media numeric; v_dp numeric; v_mono numeric; v_strain numeric;
  v_blocos numeric[] := '{}';
  v_cronica numeric; v_acwr numeric; v_hist boolean;
  v_semanas jsonb := '[]'::jsonb;
  b int; seg date; v_sem numeric[]; s_soma numeric; s_dp numeric; s_mono numeric;
begin
  if not public.eh_treinador_de(_aluno) then
    raise exception 'apenas o treinador do aluno ve as metricas de carga' using errcode = '42501';
  end if;

  select min(x) into v_primeiro from (
    select min(data) x from public.session_logs where aluno_id = _aluno and finalizada
    union all select min(data) from public.extra_sessions where aluno_id = _aluno) t;

  select array_agg(carga order by dia) into v_atual from public.carga_diaria(_aluno, _ate - 6, _ate);
  select sum(c), avg(c), stddev_pop(c) into v_soma, v_media, v_dp from unnest(v_atual) c;
  v_mono := case when v_dp > 0 then v_media / v_dp end;
  v_strain := case when v_mono is not null then v_soma * v_mono end;

  for b in 1..4 loop
    v_blocos := v_blocos || (select sum(carga) from public.carga_diaria(_aluno, _ate - 6 - 7*b, _ate - 7*b));
  end loop;
  v_hist := v_primeiro is not null and v_primeiro <= _ate - 28;
  select avg(x) into v_cronica from unnest(v_blocos) x;
  v_acwr := case when v_hist and v_cronica > 0 then v_soma / v_cronica end;

  for b in reverse 7..0 loop
    seg := date_trunc('week', _ate)::date - 7*b;
    select array_agg(carga order by dia) into v_sem from public.carga_diaria(_aluno, seg, seg + 6);
    select sum(c), stddev_pop(c) into s_soma, s_dp from unnest(v_sem) c;
    s_mono := case when s_dp > 0 then (s_soma/7) / s_dp end;
    v_semanas := v_semanas || jsonb_build_object(
      'segunda', seg, 'soma', s_soma, 'parcial', seg + 6 > _ate,
      'monotonia', case when seg + 6 <= _ate then round(s_mono, 2) end,
      'strain', case when seg + 6 <= _ate and s_mono is not null then round(s_soma * s_mono) end);
  end loop;

  return jsonb_build_object(
    'ate', _ate, 'dias_7', to_jsonb(v_atual), 'carga_7d', v_soma,
    'monotonia', round(v_mono, 2), 'strain', round(v_strain),
    'blocos_anteriores', to_jsonb(v_blocos), 'cronica_media', round(v_cronica, 1),
    'acwr', round(v_acwr, 2), 'historico_suficiente', v_hist, 'primeiro_registro', v_primeiro,
    'dias_ate_acwr', case when v_primeiro is null then 28 else greatest(0, (v_primeiro - (_ate - 28))) end,
    'carga_28_dias', (select jsonb_agg(jsonb_build_object('dia', dia, 'carga', carga) order by dia)
                        from public.carga_diaria(_aluno, _ate - 27, _ate)),
    'semanas', v_semanas);
end;
$function$;

revoke execute on function public.carga_diaria(uuid, date, date) from public, anon;
revoke execute on function public.metricas_carga(uuid, date) from public, anon;
grant execute on function public.carga_diaria(uuid, date, date) to authenticated;
grant execute on function public.metricas_carga(uuid, date) to authenticated;
