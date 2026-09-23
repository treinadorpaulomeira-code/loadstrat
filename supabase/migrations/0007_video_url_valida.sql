-- o endereco do video so pode ser um link do YouTube (formato canonico) ou um arquivo do nosso bucket
alter table public.exercises add constraint exercises_video_url_valida check (
  video_url is null
  or video_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'
  or video_url ~ '^https://bqprycsbkwrtxsqmskpw\.supabase\.co/storage/v1/object/public/exercise-videos/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
);
