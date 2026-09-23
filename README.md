# LOADSTRAT

App de gestão de treino do Treinador Paulo Meira: um painel para o treinador e um app
mobile-first para o aluno, sobre o mesmo Supabase e o mesmo login.

**No ar:** https://treinadorpaulomeira-code.github.io/loadstrat/

## Como funciona

- `index.html`, `estilo.css`, `app.js` — o site inteiro (sem build). O `index.html` aponta
  para os assets com `?v=N`; **suba o N** a cada publicação para o navegador do aluno não
  ficar com a versão antiga.
- Supabase (projeto `bqprycsbkwrtxsqmskpw`): Auth por e-mail/senha, Postgres com RLS ligada
  em todas as tabelas e Storage (`exercise-videos`) para os vídeos. No banco fica só a URL.
- `supabase/migrations/` — todo o schema em ordem. As mesmas migrações estão guardadas no
  próprio Supabase (histórico de migrations).
- `supabase/functions/criar-aluno` — cria a conta do aluno e o vínculo com o treinador
  (é o único caminho para criar vínculo; o cliente não insere em `students`).

## Regras que não podem ser quebradas

- **O aluno nunca vê UA, ACWR, monotonia ou strain.** Ele vê carga externa (kg, reps, tempo,
  distância) e rótulos (leve/moderada/alta). A função `metricas_carga` recusa quem não for o
  treinador do aluno; `carga_diaria` devolve vazio; `plano_do_aluno` entrega só fase e rótulos.
- Carga interna = PSE × minutos. ACWR = carga de 7 dias ÷ média dos 4 blocos anteriores
  (só depois de 28 dias de registro). Monotonia (Foster) = média diária ÷ desvio-padrão dos
  7 dias, com dias sem treino contando como zero. Strain = carga semanal × monotonia.
- `exercises.video_url` aceita só link canônico do YouTube ou arquivo do bucket (check no banco).
- A forma de registro (carga × reps, carga × tempo, carga × distância, só reps, só tempo)
  é de cada exercício **dentro da prescrição**, não do exercício da biblioteca.
- Densidade do exercício (ED) = volume ÷ tempo de recuperação, contando só os intervalos
  **entre séries do mesmo exercício** (N séries → N−1 intervalos). Volume (AVL) = Σ séries ×
  reps × kg; índice de volume (IV) = AVL ÷ massa corporal. Na sessão ao vivo o intervalo vem
  dos horários reais (`workout_sets.iniciada_em` / `concluida_em`), nunca do descanso prescrito.

## Contas de teste

`treinador.teste@loadstrat.app`, `aluno.teste@loadstrat.app`, `carga.sintetica@loadstrat.app`,
`rival@loadstrat.app` — todas com a senha `LoadStrat#2026`. A conta "Carga Sintética" existe
para conferir os cálculos de carga contra a planilha/relatório.

## Testes

- `testes/` — teste offline que roda o `index.html` e o `app.js` reais num DOM simulado com um
  Supabase falso: `node teste.mjs` (156 checagens; precisa de `npm i jsdom`). Cobre ondulação,
  check-in, vídeos, registro por prescrição, cronômetro, periodização, 1RM, hidratação,
  calendário, prontidão, progressão e a sessão ao vivo do treinador.
- Os testes de permissão (RLS) são feitos por SQL direto no Supabase, simulando cada papel.

## Fora do escopo (combinado)

Sem wearables, sem pagamentos, sem push e sem venda para outros treinadores.
