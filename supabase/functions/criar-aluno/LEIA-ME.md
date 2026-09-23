# Função `criar-aluno`

Roda no servidor com a chave de serviço. É o único lugar onde o vínculo
treinador↔aluno nasce — não existe policy de INSERT em `students` para o
cliente, de propósito: assim um treinador não consegue se vincular a um
aluno que não é dele.

O que ela faz, nessa ordem:

1. confere quem está chamando pelo JWT
2. recusa se o papel não for `treinador`
3. cria a conta do aluno já confirmada, com senha temporária legível
4. completa o perfil e cria o vínculo
5. se qualquer passo falhar, apaga a conta para não deixar órfã

O código vive no projeto Supabase (deploy via MCP). Esta pasta documenta a decisão.
