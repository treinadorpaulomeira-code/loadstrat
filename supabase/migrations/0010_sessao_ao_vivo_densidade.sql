-- 0010_sessao_ao_vivo_densidade.sql
-- Sessão ao vivo conduzida pelo treinador (presencial).
-- Guarda o horário real de início e de fim de cada série, para
-- calcular a Densidade do Exercício = volume ÷ tempo de recuperação
-- entre séries do MESMO exercício (kg/s). Também registra quem
-- lançou a sessão e o nome de um treino livre (sem prescrição).

alter table public.workout_sets
  add column if not exists iniciada_em  timestamptz,
  add column if not exists concluida_em timestamptz;

comment on column public.workout_sets.iniciada_em is
  'Quando a série começou (botão ▶ na sessão ao vivo). Base do tempo de trabalho.';
comment on column public.workout_sets.concluida_em is
  'Quando a série terminou (botão ✓). O intervalo até a iniciada_em da série seguinte do mesmo exercício é o tempo de recuperação.';

alter table public.session_logs
  add column if not exists registrada_por uuid references public.profiles(id) on delete set null,
  add column if not exists nome_livre     text;

comment on column public.session_logs.registrada_por is
  'Preenchido quando foi o treinador que registrou a sessão ao vivo; nulo quando o próprio aluno lançou pelo app.';
comment on column public.session_logs.nome_livre is
  'Nome do treino quando a sessão não veio de uma prescrição (treino livre montado na hora).';
