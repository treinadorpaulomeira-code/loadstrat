-- Bucket dos vídeos demonstrativos (aplicado no projeto como storage_bucket_videos_exercicios)
-- public = true: servido pela CDN, sem URL que expira — carrega rápido no celular.
-- No banco fica só a URL (exercises.video_url); o arquivo nunca entra em tabela.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-videos','exercise-videos', true, 52428800,
        array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public=excluded.public,
  file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

create policy "video leitura autenticado" on storage.objects for select to authenticated
  using (bucket_id = 'exercise-videos');
create policy "video upload do treinador" on storage.objects for insert to authenticated
  with check (bucket_id='exercise-videos' and public.meu_papel()='treinador'
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "video update do treinador" on storage.objects for update to authenticated
  using (bucket_id='exercise-videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "video delete do treinador" on storage.objects for delete to authenticated
  using (bucket_id='exercise-videos' and (storage.foldername(name))[1] = auth.uid()::text);
