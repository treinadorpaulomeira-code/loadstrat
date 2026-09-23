-- a forma de registrar (carga x reps, carga x tempo, distancia...) passa a ser da prescricao, nao do exercicio
alter table public.workout_sets
  add column if not exists tempo_s integer check (tempo_s >= 0 and tempo_s <= 36000),
  add column if not exists dist_m  numeric(8,1) check (dist_m >= 0 and dist_m <= 100000);
comment on column public.exercises.categoria is 'legado: a forma de registro agora fica em cada item do treino (estrutura[].registro)';
