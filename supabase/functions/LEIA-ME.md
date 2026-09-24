# Edge functions

- `criar-aluno` — cria a conta do aluno e o vínculo com o treinador (único caminho para
  nascer um vínculo; o cliente não insere em `students`).
- `mp-cobranca` — gera o Pix de UMA cobrança no Mercado Pago. Precisa de login.
- `mp-webhook` — recebe o aviso do Mercado Pago e dá baixa. Sem JWT (quem chama é o MP),
  mas **não confia no aviso**: usa só o ID e pergunta o estado real para a API do MP.

## Ligar o Mercado Pago (feito pelo Paulo, uma vez)

1. mercadopago.com.br → **Seu negócio → Configurações → Gerenciar credenciais**
   → copiar o **Access Token de produção**.
2. Supabase → **Edge Functions → Secrets** → novo segredo
   `MP_ACCESS_TOKEN` = o token copiado. (Nunca colar o token em arquivo do repositório.)
3. Mercado Pago → **Webhooks / Notificações** → URL:
   `https://bqprycsbkwrtxsqmskpw.supabase.co/functions/v1/mp-webhook`
   → evento **Pagamentos**.

Enquanto o segredo não existir, o app do aluno avisa que o pagamento pelo aplicativo
ainda não está ligado e o treinador continua dando baixa na mão.
