-- ============================================================
-- LOADSTRAT — esquema inicial
-- Paulo Meira · treinador + alunos
-- RLS LIGADA EM TODAS AS TABELAS. O banco nunca fica aberto.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. profiles  (1:1 com auth.users)
-- ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  papel       text not null check (papel in ('treinador','aluno')),
  nome        text not null,
  sexo        text check (sexo in ('F','M','outro')),
  peso_kg     numeric(5,2) check (peso_kg > 0 and peso_kg < 400),
  altura_cm   numeric(5,1) check (altura_cm > 0 and altura_cm < 300),
  objetivo    text,
  esporte     text,
  nascimento  date,
  telefone    text,
  criado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2. students  (vínculo treinador <-> aluno)
-- ------------------------------------------------------------
create table public.students (
  id           uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id     uuid not null references public.profiles(id) on delete cascade,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  unique (treinador_id, aluno_id),
  check (treinador_id <> aluno_id)
);
create index students_treinador_idx on public.students(treinador_id) where ativo;
create index students_aluno_idx     on public.students(aluno_id) where ativo;

-- ------------------------------------------------------------
-- Helpers de autorização.
-- SECURITY DEFINER: leem students/profiles ignorando RLS, para que
-- as políticas possam chamá-las sem recursão infinita.
-- ------------------------------------------------------------
create or replace function public.eh_treinador_de(_aluno uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students s
    where s.treinador_id = auth.uid()
      and s.aluno_id = _aluno
      and s.ativo
  );
$$;

create or replace function public.meu_papel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.profiles where id = auth.uid();
$$;

-- Vale para os dois lados: o próprio dono ou o treinador dele.
create or replace function public.pode_ver_aluno(_aluno uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _aluno = auth.uid() or public.eh_treinador_de(_aluno);
$$;

revoke execute on function public.eh_treinador_de(uuid)  from anon;
revoke execute on function public.meu_papel()            from anon;
revoke execute on function public.pode_ver_aluno(uuid)   from anon;

-- ------------------------------------------------------------
-- 3. exercises  (owner_id NULL = biblioteca padrão, lida por todos)
-- ------------------------------------------------------------
create table public.exercises (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.profiles(id) on delete cascade,
  nome       text not null,
  grupo      text,
  padrao     text,
  categoria  text not null default 'forca' check (categoria in ('forca','tempo')),
  video_url  text,
  obs        text,
  criado_em  timestamptz not null default now()
);
create index exercises_owner_idx on public.exercises(owner_id);
create index exercises_nome_idx  on public.exercises(lower(nome));

-- ------------------------------------------------------------
-- 4. workouts  (treino prescrito)
-- ------------------------------------------------------------
create table public.workouts (
  id           uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id     uuid not null references public.profiles(id) on delete cascade,
  nome         text not null,
  estrutura    jsonb not null default '[]'::jsonb,
  status       text not null default 'rascunho' check (status in ('rascunho','publicado')),
  data         date not null default current_date,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index workouts_aluno_idx on public.workouts(aluno_id, data desc);

-- ------------------------------------------------------------
-- 5. session_logs  (execução de um treino)
-- ------------------------------------------------------------
create table public.session_logs (
  id          uuid primary key default gen_random_uuid(),
  workout_id  uuid references public.workouts(id) on delete set null,
  aluno_id    uuid not null references public.profiles(id) on delete cascade,
  pse         smallint check (pse between 1 and 10),
  duracao_min integer check (duracao_min >= 0 and duracao_min < 600),
  data        date not null default current_date,
  finalizada  boolean not null default false,
  obs         text,
  criado_em   timestamptz not null default now()
);
create index session_logs_aluno_idx on public.session_logs(aluno_id, data desc);

-- ------------------------------------------------------------
-- 6. workout_sets  (série a série, estilo Treino.io)
-- ------------------------------------------------------------
create table public.workout_sets (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.session_logs(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  serie_num   smallint not null check (serie_num > 0),
  carga_kg    numeric(6,2) check (carga_kg >= 0),
  reps        smallint check (reps >= 0),
  concluida   boolean not null default false,
  criado_em   timestamptz not null default now(),
  unique (session_id, exercise_id, serie_num)
);
create index workout_sets_session_idx  on public.workout_sets(session_id);
create index workout_sets_exercise_idx on public.workout_sets(exercise_id);

-- ------------------------------------------------------------
-- 7. checkins  (matinal — 1 por aluno por dia)
-- ------------------------------------------------------------
create table public.checkins (
  id         uuid primary key default gen_random_uuid(),
  aluno_id   uuid not null references public.profiles(id) on delete cascade,
  data       date not null default current_date,
  sono_horas numeric(3,1) check (sono_horas >= 0 and sono_horas <= 24),
  sono_qual  smallint check (sono_qual between 1 and 5),
  wellness   smallint check (wellness between 1 and 5),
  dor        jsonb not null default '{}'::jsonb,
  tqr        smallint check (tqr between 6 and 20),
  ciclo      jsonb,
  criado_em  timestamptz not null default now(),
  unique (aluno_id, data)
);
create index checkins_aluno_idx on public.checkins(aluno_id, data desc);

-- ------------------------------------------------------------
-- 8. periodization  (só o treinador)
-- ------------------------------------------------------------
create table public.periodization (
  id           uuid primary key default gen_random_uuid(),
  treinador_id uuid not null references public.profiles(id) on delete cascade,
  aluno_id     uuid not null references public.profiles(id) on delete cascade,
  modelo       text not null,
  fases        jsonb not null default '[]'::jsonb,
  inicio       date,
  fim          date,
  criado_em    timestamptz not null default now()
);
create index periodization_aluno_idx on public.periodization(aluno_id);

-- ------------------------------------------------------------
-- 9. extra_sessions  (treinos adicionais do aluno)
-- ------------------------------------------------------------
create table public.extra_sessions (
  id          uuid primary key default gen_random_uuid(),
  aluno_id    uuid not null references public.profiles(id) on delete cascade,
  tipo        text not null,
  descricao   text,
  duracao_min integer check (duracao_min >= 0 and duracao_min < 600),
  pse         smallint check (pse between 1 and 10),
  data        date not null default current_date,
  criado_em   timestamptz not null default now()
);
create index extra_sessions_aluno_idx on public.extra_sessions(aluno_id, data desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles       enable row level security;
alter table public.students       enable row level security;
alter table public.exercises      enable row level security;
alter table public.workouts       enable row level security;
alter table public.session_logs   enable row level security;
alter table public.workout_sets   enable row level security;
alter table public.checkins       enable row level security;
alter table public.periodization  enable row level security;
alter table public.extra_sessions enable row level security;

-- ---- profiles ----
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or public.eh_treinador_de(id));
create policy profiles_ins on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy profiles_upd on public.profiles for update to authenticated
  using (id = auth.uid() or public.eh_treinador_de(id))
  with check (id = auth.uid() or public.eh_treinador_de(id));

-- ---- students ---- (só o treinador cria/desfaz o vínculo; o aluno vê o seu)
create policy students_sel on public.students for select to authenticated
  using (treinador_id = auth.uid() or aluno_id = auth.uid());
create policy students_ins on public.students for insert to authenticated
  with check (treinador_id = auth.uid() and public.meu_papel() = 'treinador');
create policy students_upd on public.students for update to authenticated
  using (treinador_id = auth.uid()) with check (treinador_id = auth.uid());
create policy students_del on public.students for delete to authenticated
  using (treinador_id = auth.uid());

-- ---- exercises ---- (padrão = leitura para todo autenticado)
create policy exercises_sel on public.exercises for select to authenticated
  using (owner_id is null or owner_id = auth.uid() or public.eh_treinador_de(owner_id));
create policy exercises_ins on public.exercises for insert to authenticated
  with check (owner_id = auth.uid() and public.meu_papel() = 'treinador');
create policy exercises_upd on public.exercises for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy exercises_del on public.exercises for delete to authenticated
  using (owner_id = auth.uid());

-- ---- workouts ---- (o aluno lê só o publicado; quem escreve é o treinador)
create policy workouts_sel on public.workouts for select to authenticated
  using (
    treinador_id = auth.uid()
    or (aluno_id = auth.uid() and status = 'publicado')
  );
create policy workouts_ins on public.workouts for insert to authenticated
  with check (treinador_id = auth.uid() and public.eh_treinador_de(aluno_id));
create policy workouts_upd on public.workouts for update to authenticated
  using (treinador_id = auth.uid()) with check (treinador_id = auth.uid());
create policy workouts_del on public.workouts for delete to authenticated
  using (treinador_id = auth.uid());

-- ---- session_logs ---- (o aluno registra o seu; o treinador lê e ajusta)
create policy session_logs_sel on public.session_logs for select to authenticated
  using (public.pode_ver_aluno(aluno_id));
create policy session_logs_ins on public.session_logs for insert to authenticated
  with check (aluno_id = auth.uid() or public.eh_treinador_de(aluno_id));
create policy session_logs_upd on public.session_logs for update to authenticated
  using (public.pode_ver_aluno(aluno_id))
  with check (public.pode_ver_aluno(aluno_id));
create policy session_logs_del on public.session_logs for delete to authenticated
  using (aluno_id = auth.uid() or public.eh_treinador_de(aluno_id));

-- ---- workout_sets ---- (herda o dono pela sessão)
create policy workout_sets_sel on public.workout_sets for select to authenticated
  using (exists (
    select 1 from public.session_logs sl
    where sl.id = session_id and public.pode_ver_aluno(sl.aluno_id)
  ));
create policy workout_sets_ins on public.workout_sets for insert to authenticated
  with check (exists (
    select 1 from public.session_logs sl
    where sl.id = session_id and public.pode_ver_aluno(sl.aluno_id)
  ));
create policy workout_sets_upd on public.workout_sets for update to authenticated
  using (exists (
    select 1 from public.session_logs sl
    where sl.id = session_id and public.pode_ver_aluno(sl.aluno_id)
  ))
  with check (exists (
    select 1 from public.session_logs sl
    where sl.id = session_id and public.pode_ver_aluno(sl.aluno_id)
  ));
create policy workout_sets_del on public.workout_sets for delete to authenticated
  using (exists (
    select 1 from public.session_logs sl
    where sl.id = session_id and public.pode_ver_aluno(sl.aluno_id)
  ));

-- ---- checkins ---- (dado de saúde: quem escreve é só o aluno)
create policy checkins_sel on public.checkins for select to authenticated
  using (public.pode_ver_aluno(aluno_id));
create policy checkins_ins on public.checkins for insert to authenticated
  with check (aluno_id = auth.uid());
create policy checkins_upd on public.checkins for update to authenticated
  using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());
create policy checkins_del on public.checkins for delete to authenticated
  using (aluno_id = auth.uid());

-- ---- periodization ---- (exclusiva do treinador: o aluno não lê)
create policy periodization_all on public.periodization for all to authenticated
  using (treinador_id = auth.uid()) with check (treinador_id = auth.uid());

-- ---- extra_sessions ----
create policy extra_sessions_sel on public.extra_sessions for select to authenticated
  using (public.pode_ver_aluno(aluno_id));
create policy extra_sessions_ins on public.extra_sessions for insert to authenticated
  with check (aluno_id = auth.uid());
create policy extra_sessions_upd on public.extra_sessions for update to authenticated
  using (aluno_id = auth.uid()) with check (aluno_id = auth.uid());
create policy extra_sessions_del on public.extra_sessions for delete to authenticated
  using (aluno_id = auth.uid());

-- ============================================================
-- Perfil criado automaticamente no cadastro
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, papel, nome)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'papel', 'aluno'),
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- atualizado_em automático
-- ============================================================
create or replace function public.touch_atualizado_em()
returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end; $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_atualizado_em();
create trigger workouts_touch before update on public.workouts
  for each row execute function public.touch_atualizado_em();
