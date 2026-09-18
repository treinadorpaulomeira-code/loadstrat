# LOADSTRAT

Sistema de gestão de treino do treinador Paulo Meira (CREF 47780-G/PR).
Duas interfaces sobre o mesmo Supabase, mesmo login:

- **Painel do treinador** — alunos, construtor de treino, biblioteca com vídeo
- **App do aluno** — treino do dia, execução série a série, check-in

## Como funciona

Front-end estático (HTML + JS puro, sem build) publicado no GitHub Pages,
falando direto com o Supabase.

- **Banco**: PostgreSQL com Row-Level Security em todas as tabelas
- **Auth**: e-mail/senha
- **Storage**: bucket `exercise-videos` — o vídeo fica no Storage, o banco guarda só a URL

A chave `anon` no `app.js` é pública de propósito. Quem protege os dados é a RLS,
não o segredo da chave.

## Estrutura

    index.html          casca das duas interfaces
    estilo.css          tema claro off-white #eef1f6 + azul #2f97ef
    app.js              autenticação, painel do treinador, app do aluno
    supabase/migrations decisões de esquema e segurança, em ordem
    supabase/functions  funções de servidor (criar conta de aluno)

## Segurança — o que já foi verificado

O esquema foi testado em Postgres local e no projeto real, com dois treinadores
e dois alunos, cobrindo: aluno não vê rascunho, treinador não vê aluno alheio,
aluno não se promove a treinador, ninguém lê nada sem login.
Ver `supabase/migrations/0004_endurecimento.sql` para os furos encontrados e fechados.
