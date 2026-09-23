// Teste offline: roda o index.html + app.js reais num DOM simulado,
// com um Supabase falso em memoria. Exercita a ondulacao ponta a ponta.
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") + "/";
const html = fs.readFileSync(RAIZ + "index.html", "utf8")
  .replace(/<script type="module"[^>]*><\/script>/, "");
let app = fs.readFileSync(RAIZ + "app.js", "utf8");
app = app.replace(/^import \{ createClient \}.*$/m, "const createClient = window.__fakeCreateClient;");

const falhas = [];
const ok = (cond, msg) => { console.log((cond ? "PASS  " : "FAIL  ") + msg); if (!cond) falhas.push(msg); };
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ---------- banco em memoria ----------
const uid = () => Math.random().toString(36).slice(2);
const T = "t1", A = "a1";
const db = {
  profiles: [
    { id: T, papel: "treinador", nome: "Paulo Teste" },
    { id: A, papel: "aluno", nome: "Ana Aluna", peso_kg: 60 },
  ],
  students: [{ id: "s1", treinador_id: T, aluno_id: A, ativo: true }],
  exercises: [
    { id: "e1", owner_id: null, nome: "Supino reto barra", grupo: "Peito", padrao: "Empurrar", categoria: "forca" },
    { id: "e2", owner_id: null, nome: "Agachamento livre", grupo: "Pernas", padrao: "Agachar", categoria: "forca" },
  ],
  workouts: [], session_logs: [], workout_sets: [], checkins: [],
  extra_sessions: [], hidratacao: [], periodization: [],
};
function rpcFalso(nome, args) {
  if (nome === "adicionar_agua") {
    let h = db.hidratacao.find((x) => x.aluno_id === usuario && x.data === args._data);
    if (!h) { h = { aluno_id: usuario, data: args._data, ml: 0, meta_ml: null }; db.hidratacao.push(h); }
    h.ml = Math.max(0, Math.min(15000, h.ml + args._ml)); h.meta_ml = args._meta ?? h.meta_ml;
    return { data: { ...h }, error: null };
  }
  if (nome === "plano_do_aluno") {
    const p = db.periodization.filter((x) => x.aluno_id === usuario).slice(-1)[0];
    if (!p) return { data: null, error: null };
    const n = Math.floor((Date.now() - new Date(p.inicio + "T12:00:00")) / (7 * 864e5)) + 1;
    return { data: { esporte: p.fases.esporte_nome, inicio: p.inicio, fim: p.fim, semana_atual: n, total: p.fases.semanas.length,
      semanas: p.fases.semanas.map((x) => ({ n: x.n, fase: x.fase, rotulo: x.rotulo, descarga: x.descarga, foco: x.foco_aluno })) }, error: null };
  }
  return null;
}
let usuario = T;

function builder(tabela) {
  const q = { tabela, filtros: [], op: "select", payload: null, single: false, head: false, limite: null, sel: "*" };
  const b = {
    select(sel = "*", opt = {}) { q.sel = sel; if (opt.head) q.head = true; if (q.op === "select") q.op = "select"; return b; },
    insert(p) { q.op = "insert"; q.payload = p; return b; },
    update(p) { q.op = "update"; q.payload = p; return b; },
    upsert(p, o) { q.op = "upsert"; q.payload = p; q.conflito = o?.onConflict?.split(","); return b; },
    delete() { q.op = "delete"; return b; },
    eq(c, v) { q.filtros.push((r) => r[c] === v); return b; },
    neq(c, v) { q.filtros.push((r) => r[c] !== v); return b; },
    in(c, vs) { q.filtros.push((r) => vs.includes(r[c])); return b; },
    gte(c, v) { q.filtros.push((r) => r[c] >= v); return b; },
    lte(c, v) { q.filtros.push((r) => r[c] <= v); return b; },
    maybeSingle() { q.single = true; return b; },
    order() { return b; },
    limit(n) { q.limite = n; return b; },
    single() { q.single = true; return b; },
    then(res, rej) { return Promise.resolve(executar(q)).then(res, rej); },
  };
  return b;
}
function executar(q) {
  const t = db[q.tabela];
  const casa = (r) => q.filtros.every((f) => f(r));
  if (q.op === "insert") {
    const linhas = [].concat(q.payload).map((p) => ({ id: uid(), criado_em: new Date().toISOString(),
      data: new Date().toISOString().slice(0, 10), finalizada: false, status: "rascunho", ...p }));
    t.push(...linhas);
    return { data: q.single ? linhas[0] : linhas, error: null };
  }
  if (q.op === "update") {
    const alvo = t.filter(casa); alvo.forEach((r) => Object.assign(r, q.payload));
    return { data: q.single ? alvo[0] : alvo, error: null };
  }
  if (q.op === "upsert") {
    const p = q.payload;
    const ex = t.find((r) => q.conflito.every((c) => r[c] === p[c]));
    if (ex) Object.assign(ex, p); else t.push({ id: uid(), criado_em: new Date().toISOString(), ...p });
    return { data: q.single ? (ex ?? t[t.length - 1]) : [ex], error: null };
  }
  if (q.op === "delete") { db[q.tabela] = t.filter((r) => !casa(r)); return { data: null, error: null }; }
  let linhas = t.filter(casa);
  if (q.tabela === "students" && q.sel.includes("aluno:"))
    linhas = linhas.map((s) => ({ ...s, aluno: db.profiles.find((p) => p.id === s.aluno_id) }));
  if (q.tabela === "workouts" && usuario === A) linhas = linhas.filter((w) => w.aluno_id === A && w.status === "publicado");
  if (q.limite) linhas = linhas.slice(0, q.limite);
  if (q.head) return { data: null, count: linhas.length, error: null };
  return { data: q.single ? linhas[0] : JSON.parse(JSON.stringify(linhas)), error: null };
}

async function abrir(quem) {
  usuario = quem;
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://x.test/" });
  const w = dom.window;
  w.__fakeCreateClient = () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: usuario } } } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({}), onAuthStateChange: () => {}, resetPasswordForEmail: async () => ({}),
    },
    from: (t) => builder(t),
    rpc: async (nome, args) => rpcFalso(nome, args) ?? (w.__rpc ? w.__rpc(nome, args) : { data: null, error: { message: "sem rpc" } }),
    functions: { invoke: async () => ({ data: {}, error: null }) },
    storage: { from: () => ({
      upload: async (c, f) => { if (w.__uploadFalha) return { data: null, error: { message: "rede" } }; db.arquivos = [...(db.arquivos ?? []), c]; return { data: { path: c }, error: null }; },
      getPublicUrl: (c) => ({ data: { publicUrl: "https://bqprycsbkwrtxsqmskpw.supabase.co/storage/v1/object/public/exercise-videos/" + c } }),
      remove: async (cs) => { db.arquivos = (db.arquivos ?? []).filter((a) => !cs.includes(a)); return { data: null, error: null }; },
    }) },
  });
  w.HTMLElement.prototype.scrollTo = () => {};
  w.scrollTo = () => {};
  w.eval(app);
  await espera(120);
  return w;
}
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const digita = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
const muda = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true })); };

// ================= TREINADOR monta treino ondulado =================
let w = await abrir(T);
ok(!$(w, "#app-treinador").hidden, "treinador cai no painel");
ok($$(w, "#sel-semanas option").length === 12 && $$(w, "#sel-freq option").length === 7, "seletores de semanas (1-12) e frequencia (1-7) montados");

$(w, "[data-nav='prescrever']").click();
$(w, "[data-add='e1']").click();
$(w, "[data-add='e2']").click();
ok($$(w, "[data-campo]").length === 12, "modo fixo: 2 exercicios x 3 series com carga/reps");

muda(w, $(w, "#sel-freq"), "2");
muda(w, $(w, "#sel-semanas"), "3");
await espera();
ok($$(w, "[data-campo]").length === 0 && $$(w, "[data-onda]").length === 2 * 3 * 3, "modo ondulado: tabela de 3 semanas por exercicio");
ok(/a cada 2 treinos/.test($(w, "#onda-dica").textContent), "dica explica que avanca a cada 2 treinos");

// semana 1: 3x10 | semana 2: 3x12 | semana 3: 4x8  (supino)
const esquema = [[3, 10, 60], [3, 12, 55], [4, 8, 65]];
esquema.forEach(([s, r, c], k) => {
  digita(w, $(w, `[data-onda='0:${k}:series']`), String(s));
  digita(w, $(w, `[data-onda='0:${k}:reps']`), String(r));
  digita(w, $(w, `[data-onda='0:${k}:carga']`), String(c));
});
$(w, "[data-aplicar='0']").click();
await espera();
ok($(w, "[data-onda='1:1:reps']").value === "12" && $(w, "[data-onda='1:2:series']").value === "4",
   "'aplicar a todos' copia series/reps para o agachamento");
ok($(w, "[data-onda='1:0:carga']").value === "", "'aplicar a todos' NAO copia a carga (cada exercicio tem a sua)");
digita(w, $(w, "[data-onda='1:0:carga']"), "80");

digita(w, $(w, "#in-nome-treino"), "Força ondulada");
$(w, "#btn-publicar").click();
await espera(150);
const wk = db.workouts[0];
ok(wk && wk.semanas === 3 && wk.sessoes_por_semana === 2, "gravou 3 semanas, 2x por semana");
ok(wk.estrutura[0].ondas.length === 3 && wk.estrutura[0].ondas[2].reps === "8", "gravou as ondas do supino");
ok(wk.estrutura[0].series.length === 3, "grava tambem as series da semana 1 (compatibilidade)");
ok(wk.estrutura[1].ondas[0].carga === "80", "carga propria do agachamento preservada");

// reabrir o treino no construtor
wk.status = "publicado";
$(w, "[data-ir='prescrever']")?.click();
w.eval("abrirTreino('" + wk.id + "')");
await espera(100);
ok($(w, "#sel-semanas").value === "3" && $(w, "#sel-freq").value === "2", "reabrir o treino restaura semanas e frequencia");
ok($(w, "[data-onda='0:1:reps']").value === "12", "reabrir mostra a onda da semana 2");

// ================= ALUNO executa e a semana avanca =================
async function cartao() {
  const w2 = await abrir(A);
  return { w2, faixa: $(w2, ".semana-faixa")?.textContent ?? "", previa: $(w2, ".lista-previa")?.textContent ?? "" };
}
async function fazTreino(w2) {
  $(w2, "[data-comecar]").click();
  await espera(120);
  const n = $$(w2, "[data-ok]").length;
  for (let k = 0; k < n; k++) { $$(w2, "[data-ok]")[k].click(); await espera(20); }
  $(w2, "#btn-terminar").click();
  $(w2, "[data-pse='7']").click();
  $(w2, "#pse-salvar").click();
  await espera(150);
  return n;
}

let c = await cartao();
ok(/Semana 1 de 3/.test(c.faixa) && /0 de 2/.test(c.faixa), "aluno ve 'Semana 1 de 3' e 0 de 2 treinos");
ok(/3×10/.test(c.previa), "previa mostra 3×10 na semana 1");
let n = await fazTreino(c.w2);
ok(n === 6, "semana 1: 3 series supino + 3 agachamento = 6 series");
ok(db.session_logs.at(-1).semana === 1, "sessao gravada como semana 1");
ok(db.workout_sets.some((s) => s.carga_kg === 60 && s.reps === 10), "serie concluida assume o alvo (60 kg × 10)");

c = await cartao();
ok(/Semana 1 de 3/.test(c.faixa) && /1 de 2/.test(c.faixa), "depois de 1 treino: continua semana 1 (1 de 2)");
await fazTreino(c.w2);

c = await cartao();
ok(/Semana 2 de 3/.test(c.faixa), "depois de 2 treinos: avancou para a semana 2");
ok(/3×12/.test(c.previa), "semana 2 mostra 3×12");
await fazTreino(c.w2); c = await cartao(); await fazTreino(c.w2);

c = await cartao();
ok(/Semana 3 de 3/.test(c.faixa) && /4×8/.test(c.previa), "semana 3 mostra 4×8");
n = await fazTreino(c.w2);
ok(n === 8, "semana 3: 4 + 4 = 8 series");
ok(db.session_logs.at(-1).semana === 3, "sessao gravada como semana 3");
c = await cartao(); await fazTreino(c.w2);

c = await cartao();
ok(/Semana 3 de 3/.test(c.faixa) && /ciclo concluído/.test(c.faixa), "fim do ciclo: fica na semana 3 e avisa 'ciclo concluído'");

// treino antigo, sem ondulacao, continua funcionando
db.workouts.push({ id: "fixo", treinador_id: T, aluno_id: A, nome: "Treino fixo", status: "publicado",
  data: "2026-09-01", semanas: 1, sessoes_por_semana: 1,
  estrutura: [{ exercise_id: "e1", nome: "Supino reto barra", series: [{ carga_alvo: "50", reps_alvo: "10" }, { carga_alvo: "50", reps_alvo: "10" }] }] });
c = await cartao();
const cards = $$(c.w2, ".treino-card");
const fixo = cards.find((el) => /Treino fixo/.test(el.textContent));
ok(fixo && !fixo.querySelector(".semana-faixa") && /2×10/.test(fixo.textContent), "treino sem ondulacao: sem faixa de semana, mostra 2×10");

// ================= ETAPA 4: CHECK-IN =================
db.profiles[1].sexo = "F";
let w3 = await abrir(A);
ok(/Como você acordou/.test($(w3, ".ck-banner")?.textContent ?? ""), "home do aluno mostra o convite de check-in");
$(w3, "[data-ir-ck]").click(); await espera(50);
ok(!!$(w3, "#ck-fase"), "aluna ve o bloco de ciclo menstrual (opcional)");
$(w3, "#ck-salvar").click(); await espera(50);
ok(/Falta responder/.test($(w3, "#ck-erro").textContent), "nao deixa enviar check-in incompleto");
$(w3, "[data-sono='0.5']").click();
$(w3, "[data-esc='sono_qual:4']").click();
$(w3, "[data-esc='wellness:2']").click();
$(w3, "[data-tqr='9']").click();
const lomb = $(w3, "[data-dor='lombar']"); lomb.click(); lomb.click(); lomb.click();
$(w3, "[data-dor='joelho_d']").click();
muda(w3, $(w3, "#ck-fase"), "lutea");
$(w3, "#ck-salvar").click(); await espera(120);
const ck = db.checkins[0];
ok(ck && ck.sono_horas === 8 && ck.sono_qual === 4 && ck.wellness === 2 && ck.tqr === 9, "check-in gravado: 8 h, sono boa, mal, TQR 9");
ok(ck && ck.dor.lombar === 3 && ck.dor.joelho_d === 1, "mapa de dor: lombar forte, joelho D leve");
ok(ck && ck.ciclo?.fase === "lutea", "ciclo gravado (pre-menstrual)");
ok(/Check-in de hoje feito/.test($(w3, ".ck-banner")?.textContent ?? ""), "banner vira 'check-in feito'");
$(w3, "[data-ir-ck]").click(); await espera(50);
ok(/já enviado/.test($(w3, "#checkin-form").textContent) && $(w3, "[data-tqr='9']").classList.contains("on"), "reabrir o check-in traz os valores salvos");
$(w3, "[data-tqr='8']").click(); $(w3, "#ck-salvar").click(); await espera(120);
ok(db.checkins.length === 1 && db.checkins[0].tqr === 8, "ajustar no mesmo dia atualiza, nao duplica");
ok(!/\bUA\b|ACWR|monotonia|strain/i.test(w3.document.querySelector("#app-aluno").textContent), "aluno nao ve UA, ACWR, monotonia nem strain");

// aluno homem nao ve bloco de ciclo
db.profiles[1].sexo = "M";
let w3b = await abrir(A);
$(w3b, "[data-ir-ck]").click(); await espera(50);
ok(!$(w3b, "#ck-fase"), "aluno do sexo masculino nao ve o bloco de ciclo");
db.profiles[1].sexo = "F";

// ================= ETAPA 4: PAINEL =================
const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
db.checkins.push({ id: "c0", aluno_id: A, data: ontem, tqr: 9, dor: {}, sono_horas: 6, sono_qual: 2, wellness: 2 });
db.checkins.sort((a, b) => b.data.localeCompare(a.data));
db.checkins.forEach((c) => (c.data = c.data)); // hoje ja tem TQR 8
const metricas = { historico_suficiente: true, acwr: 1.4, monotonia: 0.87, strain: 1455, carga_7d: 1680,
  dias_7: [0, 560, 0, 560, 0, 0, 560], dias_ate_acwr: 0,
  carga_28_dias: Array.from({ length: 28 }, (_, k) => ({ dia: new Date(Date.now() - (27 - k) * 864e5).toISOString().slice(0, 10), carga: k % 2 ? 560 : 0 })),
  semanas: [{ segunda: "2026-09-07", soma: 1610, monotonia: 0.97, strain: 1566, parcial: false },
            { segunda: "2026-09-14", soma: 1680, monotonia: 0.87, strain: 1455, parcial: false },
            { segunda: "2026-09-21", soma: 560, monotonia: null, strain: null, parcial: true }] };
let w4 = await abrir(T);
w4.__rpc = async () => ({ data: metricas, error: null });
w4.eval("carregarAlertas()"); await espera(150);
const alertasTxt = $(w4, "#tb-alertas").textContent;
ok(/ACWR acima da faixa/.test(alertasTxt), "alerta: ACWR 1,40 acima da faixa");
ok(/Recuperação baixa 2 dias seguidos/.test(alertasTxt), "alerta: TQR abaixo de 10 dois dias seguidos (9 e 8)");
ok(/Dor forte hoje/.test(alertasTxt) && /Lombar/.test(alertasTxt), "alerta: dor forte hoje na lombar");

// perfil do aluno
w4.eval("abrirPerfil('" + A + "')"); await espera(200);
const stats = $(w4, "#pf-stats").textContent;
ok(/1\.680/.test(stats) && /1,40/.test(stats) && /0,87/.test(stats) && /1\.455/.test(stats), "cards: carga 1.680 · ACWR 1,40 · monotonia 0,87 · strain 1.455");
ok(/acima da faixa/.test(stats) && /baixa/.test(stats), "classificacoes nas mesmas faixas do relatorio");
ok($$(w4, "#pf-graf-carga svg path").length >= 14, "grafico de carga diaria desenhado (barras)");
ok(/em andamento/.test($(w4, "#pf-semanas").textContent) && /fecha no domingo/.test($(w4, "#pf-semanas").textContent), "semana em andamento nao calcula monotonia");
ok(/Lombar · forte/.test($(w4, "#pf-checkins").textContent) && /Pré-menstrual/.test($(w4, "#pf-checkins").textContent), "tabela de check-ins com dor e ciclo");

// historico sem ACWR
w4.__rpc = async () => ({ data: { ...metricas, historico_suficiente: false, acwr: null, dias_ate_acwr: 9 }, error: null });
w4.eval("abrirPerfil('" + A + "')"); await espera(200);
ok(/aguardando histórico/.test($(w4, "#pf-stats").textContent) && /liga em 9 dias/.test($(w4, "#pf-stats").textContent), "sem historico: 'aguardando histórico — liga em 9 dias'");

// evolucao por exercicio (vem das sessoes executadas acima)
const opcoes = $$(w4, "#pf-exercicio option").map((o) => o.textContent);
ok(opcoes.includes("Supino reto barra"), "seletor de evolucao lista os exercicios feitos");
ok($$(w4, "#pf-ex-tabela tr").length >= 2 && /kg ×/.test($(w4, "#pf-ex-tabela").textContent), "tabela de evolucao com melhor serie por treino");
ok(!!$(w4, "#pf-graf-ex svg path[stroke]"), "grafico de linha da evolucao desenhado");

// ================= EXERCICIOS COM VIDEO =================
let w5 = await abrir(T);
const idYT = (u) => w5.eval("idYoutube(" + JSON.stringify(u) + ")");
ok(idYT("https://youtu.be/dQw4w9WgXcQ?si=abc") === "dQw4w9WgXcQ", "link youtu.be (com ?si=) reconhecido");
ok(idYT("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s") === "dQw4w9WgXcQ", "link watch?v= reconhecido");
ok(idYT("youtube.com/shorts/dQw4w9WgXcQ") === "dQw4w9WgXcQ", "link de Shorts (sem https) reconhecido");
ok(idYT("https://m.youtube.com/watch?v=dQw4w9WgXcQ") === "dQw4w9WgXcQ", "link do celular (m.youtube) reconhecido");
ok(idYT("https://vimeo.com/123") === null && idYT("javascript:alert(1)") === null, "links que nao sao do YouTube sao recusados");

// criar pelo atalho da tela inicial, com link do YouTube
$(w5, "#atalho-novo-ex").click(); await espera();
ok(/Novo exercício/.test($(w5, "#modal h3").textContent), "atalho 'Novo exercício' abre o formulario");
digita(w5, $(w5, "#e-nome"), "Agachamento búlgaro");
digita(w5, $(w5, "#e-yt"), "https://youtu.be/dQw4w9WgXcQ");
ok(!!$(w5, "#e-yt-prev iframe"), "previa do YouTube aparece ao colar o link");
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(120);
let criado = db.exercises.find((e) => e.nome === "Agachamento búlgaro");
ok(criado && criado.owner_id === T && criado.video_url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "grava so o link canonico do YouTube");
w5.eval("irPara('biblioteca')"); await espera();
ok([...w5.document.querySelectorAll("#grid-bib .card-ex")].some((c) => /Agachamento búlgaro/.test(c.textContent) && c.querySelector("iframe")), "biblioteca mostra o player do YouTube");

// link invalido nao grava
$(w5, "#btn-novo-ex").click(); await espera();
digita(w5, $(w5, "#e-nome"), "Teste link ruim");
digita(w5, $(w5, "#e-yt"), "https://site.com/video");
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(60);
ok(/não parece ser de um vídeo do YouTube/.test($(w5, "#e-erro").textContent) && !db.exercises.some((e) => e.nome === "Teste link ruim"), "link invalido: avisa e nao cria");
w5.eval("fecharModal()");

// arquivo do celular
const arquivo = (nome, tipo, mb) => { const f = new w5.File(["x"], nome, { type: tipo }); Object.defineProperty(f, "size", { value: mb * 1048576 }); return f; };
const escolhe = (f) => { const inp = $(w5, "#e-arquivo"); Object.defineProperty(inp, "files", { value: [f], configurable: true }); inp.dispatchEvent(new w5.Event("change")); };
w5.URL.createObjectURL = () => "blob:x"; w5.URL.revokeObjectURL = () => {};
$(w5, "#btn-novo-ex").click(); await espera();
digita(w5, $(w5, "#e-nome"), "Remada serrote");
$(w5, "[data-vmodo='arquivo']").click();
escolhe(arquivo("IMG_0001.MOV", "video/quicktime", 80));
ok(/limite é 50 MB/.test($(w5, "#e-erro").textContent), "video grande demais: avisa o limite e sugere o YouTube");
escolhe(arquivo("IMG_0001.MOV", "video/quicktime", 12));
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(150);
criado = db.exercises.find((e) => e.nome === "Remada serrote");
ok(criado && /exercise-videos\/t1\/.+\.mov$/.test(criado.video_url) && db.arquivos.length === 1, "video do celular sobe para a pasta do treinador e o banco guarda o endereco");

// falha de rede no upload: nada fica gravado
w5.__uploadFalha = true;
$(w5, "#btn-novo-ex").click(); await espera();
digita(w5, $(w5, "#e-nome"), "Sem rede");
$(w5, "[data-vmodo='arquivo']").click();
escolhe(arquivo("a.mp4", "video/mp4", 5));
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(150);
ok(!db.exercises.some((e) => e.nome === "Sem rede") && /não subiu/.test($(w5, "#e-erro").textContent), "upload falhou: avisa e nao cria exercicio sem video");
w5.__uploadFalha = false; w5.eval("fecharModal()");

// editar: trocar o arquivo por link do YouTube apaga o arquivo antigo
w5.eval("abrirExercicio({ id: '" + criado.id + "' })"); await espera();
ok(!!$(w5, "[data-vmodo='manter'].on"), "editar abre com 'manter atual' selecionado");
$(w5, "[data-vmodo='youtube']").click();
digita(w5, $(w5, "#e-yt"), "https://www.youtube.com/shorts/aaaaaaaaaaa");
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(150);
ok(criado.video_url === "https://www.youtube.com/watch?v=aaaaaaaaaaa" && db.arquivos.length === 0, "trocar para YouTube: grava o link e remove o arquivo antigo do Storage");

// exercicio padrao: vira copia do treinador
w5.eval("abrirExercicio({ base: 'e1' })"); await espera();
digita(w5, $(w5, "#e-yt"), "https://youtu.be/bbbbbbbbbbb");
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(150);
ok(db.exercises.find((e) => e.id === "e1").video_url == null && db.exercises.some((e) => e.owner_id === T && e.nome === "Supino reto barra" && /bbbbbbbbbbb/.test(e.video_url)), "exercicio da biblioteca padrao: cria copia do treinador com o video");

// criar direto do construtor ja entra no treino
w5.eval("irPara('prescrever')"); await espera();
digita(w5, $(w5, "#in-busca-lib"), "Pallof");
$(w5, "#btn-criar-ex-lib").click(); await espera();
ok($(w5, "#e-nome").value === "Pallof", "criar a partir da busca ja preenche o nome");
$(w5, "#form-ex").dispatchEvent(new w5.Event("submit", { cancelable: true })); await espera(150);
ok(/Pallof/.test($(w5, "#lista-ex").textContent), "exercicio criado no construtor entra direto no treino");

// aluno ve o player do YouTube na execucao
const pal = db.exercises.find((e) => e.nome === "Agachamento búlgaro");
db.workouts.push({ id: "wyt", treinador_id: T, aluno_id: A, nome: "Com YouTube", status: "publicado", data: "2026-09-30", semanas: 1, sessoes_por_semana: 1,
  estrutura: [{ exercise_id: pal.id, nome: pal.nome, series: [{ reps_alvo: "10" }] }] });
let w6 = await abrir(A);
[...w6.document.querySelectorAll("[data-comecar]")].find((b) => b.dataset.comecar === "wyt").click(); await espera(150);
ok(!!w6.document.querySelector("#exec-lista .yt iframe[src*='youtube-nocookie.com/embed/dQw4w9WgXcQ']"), "aluno ve o video do YouTube dentro do treino");

// ================= REGISTRO POR PRESCRICAO =================
let w7 = await abrir(T);
const seg = (t) => w7.eval("segundos(" + JSON.stringify(t) + ")");
ok(seg("45") === 45 && seg("45s") === 45 && seg("1:30") === 90 && seg("1'30") === 90 && seg("2min") === 120 && seg("abc") === null, "tempo aceita 45, 45s, 1:30, 1'30 e 2min");
$(w7, "#atalho-novo-ex").click(); await espera();
ok(!$(w7, "#e-categoria"), "formulario do exercicio nao tem mais o campo 'Tipo'");
w7.eval("fecharModal()");

$(w7, "[data-nav='prescrever']").click();
$(w7, "[data-add='e2']").click();   // agachamento
$(w7, "[data-add='e1']").click();   // supino
const sel = $(w7, "[data-registro='0']");
ok(!!sel && sel.value === "carga_reps", "cada exercicio no treino tem o seletor de registro (padrao carga × reps)");
muda(w7, sel, "carga_tempo"); await espera();
const cab0 = [...w7.document.querySelectorAll(".exblock")][0].querySelector("thead").textContent;
ok(/Carga \(kg\)/.test(cab0) && /Tempo \(s\)/.test(cab0) && !/Reps/.test(cab0), "agachamento em carga × tempo: colunas Carga e Tempo");
const cab1 = [...w7.document.querySelectorAll(".exblock")][1].querySelector("thead").textContent;
ok(/Reps/.test(cab1), "o outro exercicio continua carga × reps");
[0, 1, 2].forEach((j) => { digita(w7, $(w7, `[data-campo='carga_alvo'][data-i='0'][data-j='${j}']`), "40"); digita(w7, $(w7, `[data-campo='tempo_alvo'][data-i='0'][data-j='${j}']`), "1:30"); });
digita(w7, $(w7, "#in-nome-treino"), "Isometria");
$(w7, "#btn-publicar").click(); await espera(150);
const iso = db.workouts.find((x) => x.nome === "Isometria");
ok(iso && iso.estrutura[0].registro === "carga_tempo" && iso.estrutura[0].series[0].tempo_alvo === "1:30", "treino grava o registro e o tempo-alvo");
iso.status = "publicado";

// mesmo exercicio, outro treino, so reps
db.workouts.push({ id: "wreps", treinador_id: T, aluno_id: A, nome: "Peso corporal", status: "publicado", data: "2026-09-29", semanas: 1, sessoes_por_semana: 1,
  estrutura: [{ exercise_id: "e2", nome: "Agachamento livre", registro: "reps", series: [{ reps_alvo: "20" }, { reps_alvo: "20" }] }] });

let w8 = await abrir(A);
ok([...w8.document.querySelectorAll(".treino-card")].some((c) => /Isometria/.test(c.textContent) && /3×1:30/.test(c.textContent)), "card do aluno mostra 3×1:30");
[...w8.document.querySelectorAll("[data-comecar]")].find((b) => b.dataset.comecar === iso.id).click(); await espera(150);
const cabA = $(w8, "#exec-lista .cab-series").textContent;
ok(/Carga kg/.test(cabA) && /Tempo/.test(cabA) && !/Reps/.test(cabA), "aluno registra carga e tempo no agachamento");
$(w8, "[data-ok='0:0']").click(); await espera(120);
let st = db.workout_sets.find((x) => x.exercise_id === "e2" && x.serie_num === 1 && x.session_id === db.session_logs[db.session_logs.length - 1].id);
ok(st && st.carga_kg === 40 && st.tempo_s === 90 && st.reps == null, "serie sem digitar assume o alvo: 40 kg por 90 s");
digita(w8, $(w8, "[data-serie='0:1:tempo']"), "1:45");
$(w8, "[data-ok='0:1']").click(); await espera(120);
st = db.workout_sets.find((x) => x.exercise_id === "e2" && x.serie_num === 2 && x.session_id === db.session_logs[db.session_logs.length - 1].id);
ok(st && st.tempo_s === 105, "tempo digitado em 1:45 grava 105 s");
$(w8, "#btn-voltar").click(); await espera(50);

w8 = await abrir(A);
[...w8.document.querySelectorAll("[data-comecar]")].find((b) => b.dataset.comecar === "wreps").click(); await espera(150);
const cabB = $(w8, "#exec-lista .cab-series").textContent;
ok(/Reps/.test(cabB) && !/Carga/.test(cabB), "mesmo agachamento em outro treino: so reps");
ok(/Última vez: .*1:45|Última vez: .*1:30/.test($(w8, "#exec-lista").textContent), "'ultima vez' mostra o tempo feito antes");

// ================= CRONOMETRO =================
let w9 = await abrir(A);
let agora = Date.now();
w9.Date.now = () => agora;
const anda = (ms) => { agora += ms; w9.eval("passoTimer()"); };
[...w9.document.querySelectorAll("[data-comecar]")].find((b) => b.dataset.comecar === iso.id).click(); await espera(150);
const sessIso = db.session_logs.find((x) => x.workout_id === iso.id && !x.finalizada);
ok(!!$(w9, "[data-cronometrar='0:2']"), "serie por tempo tem o botao de cronometrar");
$(w9, "[data-cronometrar='0:2']").click();
ok(!$(w9, "#timer").hidden && $(w9, "#timer").dataset.fase === "preparo" && $(w9, "#timer-num").textContent === "3", "abre com 'prepare-se' 3-2-1");
anda(3100);
ok($(w9, "#timer").dataset.fase === "trabalho" && $(w9, "#timer-num").textContent === "01:30", "depois do preparo conta 1:30 para baixo");
anda(60000);
ok($(w9, "#timer-num").textContent === "00:30", "contagem regressiva correta (00:30)");
anda(30100); await espera(120);
let s3 = db.workout_sets.find((x) => x.session_id === sessIso.id && x.exercise_id === "e2" && x.serie_num === 3);
ok(s3 && s3.tempo_s === 90 && s3.concluida && s3.carga_kg === 40, "ao zerar, registra 90 s com a carga prescrita e marca a serie");
ok(!$(w9, "#timer").hidden && $(w9, "#timer").dataset.modo === "descanso", "em seguida comeca o descanso sozinho");
ok(/Próximo: Supino reto barra/.test($(w9, "#timer-sub").textContent), "descanso mostra o proximo exercicio");
const inicioDesc = $(w9, "#timer-num").textContent;
$(w9, "[data-tajuste='15']").click();
const emSeg = (t) => { const [m, x] = t.split(":").map(Number); return m * 60 + x; };
ok(emSeg($(w9, "#timer-num").textContent) - emSeg(inicioDesc) === 15, "+15s soma 15 segundos ao descanso (" + inicioDesc + " → " + $(w9, "#timer-num").textContent + ")");
$(w9, "[data-tajuste='-15']").click();
ok(emSeg($(w9, "#timer-num").textContent) === emSeg(inicioDesc), "−15s tira 15 segundos");
const antesPausa = $(w9, "#timer-num").textContent;
$(w9, "#timer-pausar").click(); anda(20000);
ok($(w9, "#timer-num").textContent === antesPausa, "pausado: o tempo nao anda");
$(w9, "#timer-pausar").click(); anda(10000);
ok($(w9, "#timer-num").textContent !== antesPausa, "continuar: volta a contar");
$(w9, "#timer-minimizar").click();
ok($(w9, "#timer").classList.contains("mini") && !$(w9, "#timer").hidden, "minimizar vira a pilula e o aluno segue anotando");
$(w9, "#timer-mini-pular").click();
ok($(w9, "#timer").hidden, "pular encerra o descanso");

// terminar a serie antes do alvo registra o tempo feito
$(w9, "[data-cronometrar='0:0']").click(); anda(3100); anda(40000);
$(w9, "#timer-fim").click(); await espera(150);
s3 = db.workout_sets.find((x) => x.session_id === sessIso.id && x.exercise_id === "e2" && x.serie_num === 1);
ok(s3 && s3.tempo_s === 40, "'terminar serie' antes do fim registra o tempo real (40 s)");
w9.eval("fecharTimer()");

// descanso manual
$(w9, "[data-descansar='0']").click();
ok(!$(w9, "#timer").hidden && $(w9, "#timer").dataset.modo === "descanso", "botao 'descansar agora' abre o descanso");
w9.eval("fecharTimer()");

// sem tempo-alvo: cronometro progressivo
db.workouts.push({ id: "wlivre", treinador_id: T, aluno_id: A, nome: "Prancha livre", status: "publicado", data: "2026-09-28", semanas: 1, sessoes_por_semana: 1,
  estrutura: [{ exercise_id: "e1", nome: "Prancha", registro: "tempo", series: [{}] }] });
let w10 = await abrir(A);
agora = Date.now(); w10.Date.now = () => agora;
[...w10.document.querySelectorAll("[data-comecar]")].find((b) => b.dataset.comecar === "wlivre").click(); await espera(150);
$(w10, "[data-cronometrar='0:0']").click(); agora += 3100; w10.eval("passoTimer()"); agora += 25000; w10.eval("passoTimer()");
ok($(w10, "#timer").dataset.fase === "livre" && $(w10, "#timer-num").textContent === "00:25", "sem alvo: cronometro conta para cima");
$(w10, "#timer-fim").click(); await espera(150);
const sl = db.session_logs.find((x) => x.workout_id === "wlivre");
ok(db.workout_sets.some((x) => x.session_id === sl.id && x.tempo_s === 25 && x.concluida), "'parar e registrar' grava 25 s");

// ================= ETAPA 5 =================
let w11 = await abrir(T);
const soma = (a) => a.reduce((x, y) => x + y.w, 0);
const fc = w11.eval("fasesDoPlano(16, 'classico')"), fa = w11.eval("fasesDoPlano(16, 'atr')");
ok(soma(fc) === 16 && fc.length === 5 && fc[0].n === "Prep. Geral" && fc[4].n === "Transição", "modelo classico: 5 fases somando 16 semanas");
ok(soma(fa) === 16 && fa.map((f) => f.w).join(",") === "4,3,2,4,3", "blocos ATR: 4-3-2 repetidos ate 16 semanas");
ok([4, 7, 10, 23, 52].every((n) => soma(w11.eval("fasesDoPlano(" + n + ", 'classico')")) === n), "fases fecham certinho para 4, 7, 10, 23 e 52 semanas");
const pl = w11.eval("gerarPlano({ esporte: 'volei', semanas: 16, sessoes: 4, modelo: 'classico', base: 2000, inicio: '2026-09-28' })");
ok(pl.fases.semanas.length === 16 && pl.fim === "2027-01-17", "plano de 16 semanas termina no domingo certo (17/01/2027)");
ok(pl.fases.semanas[3].descarga && pl.fases.semanas[3].ua < pl.fases.semanas[2].ua, "4a semana e descarga (onda 3:1)");
ok(pl.fases.semanas[15].polimento && pl.fases.semanas[15].rotulo === "leve", "ultimas semanas: polimento, rotulo leve");
ok(pl.fases.micro.length === 4 && pl.fases.mesos.length === 5, "microciclo com 4 sessoes e 5 mesociclos");

// planejador na tela
w11.__rpc = async (nome) => nome === "metricas_carga" ? { data: { cronica_media: 1500 }, error: null } : { data: [], error: null };
$(w11, "[data-nav='periodizacao']").click(); await espera(120);
ok($(w11, "#per-aluno").value === A && $(w11, "#per-base").value === "1500", "planejador sugere a carga base pela media das ultimas 4 semanas");
$(w11, "[data-esporte='volei']").click();
digita(w11, $(w11, "#per-semanas"), "12");
$(w11, "#per-form").dispatchEvent(new w11.Event("submit", { cancelable: true })); await espera(80);
ok(!!$(w11, "#per-resultado .macro") && $$(w11, "#per-graf svg path").length === 12, "gera macrociclo e grafico com 12 semanas");
ok(/Vôlei/.test($(w11, "#per-resultado").textContent) && /Mesociclos/.test($(w11, "#per-resultado").textContent), "mostra esporte, capacidades e mesociclos");
digita(w11, $(w11, "#per-semanas"), "2");
$(w11, "#per-form").dispatchEvent(new w11.Event("submit", { cancelable: true })); await espera(30);
ok(/entre 4 e 52/.test($(w11, "#per-erro").textContent), "temporada curta demais: avisa");
digita(w11, $(w11, "#per-semanas"), "12");
$(w11, "#per-form").dispatchEvent(new w11.Event("submit", { cancelable: true })); await espera(30);
$(w11, "#per-salvar").click(); await espera(150);
const pz = db.periodization[0];
ok(pz && pz.treinador_id === T && pz.aluno_id === A && pz.fases.semanas.length === 12 && pz.fases.esporte === "volei", "salva a periodizacao do aluno");

// 1RM no perfil
db.profiles[1].peso_kg = 60; db.profiles[1].sexo = "F";
db.session_logs.push({ id: "rmS", aluno_id: A, finalizada: true, data: "2026-09-20", workout_id: "x" });
db.workout_sets.push({ session_id: "rmS", exercise_id: "e1", serie_num: 1, carga_kg: 100, reps: 5, concluida: true });
w11 = await abrir(T);
w11.__rpc = async (nome) => nome === "metricas_carga" ? { data: { historico_suficiente: false, dias_7: [], carga_28_dias: [], semanas: [] }, error: null } : { data: [], error: null };
w11.eval("abrirPerfil('" + A + "')"); await espera(250);
const rmTxt = [...w11.document.querySelectorAll("#pf-rm tr")].find((r) => /Supino reto barra/.test(r.textContent))?.textContent ?? "";
ok(/116,7/.test(rmTxt) && /112,5/.test(rmTxt) && /114,6 kg/.test(rmTxt), "1RM: Epley 116,7 · Brzycki 112,5 · media 114,6 kg (100 kg × 5)");
ok(/1,91×/.test(rmTxt) && /Elite/.test(rmTxt), "relativo ao peso (60 kg): 1,91× — nivel pela tabela feminina");
ok(/semana \d+ de 12|Começa em/.test($(w11, "#pf-plano").textContent) && !!$(w11, "#pf-graf-plano svg"), "perfil mostra a fase e o grafico planejado × realizado");

// aluno: treino extra
let w12 = await abrir(A);
ok(!!$(w12, "[data-atalho='extra']") && !!$(w12, "[data-atalho='agua']") && !!$(w12, "[data-atalho='calendario']"), "home do aluno tem atalhos de treino extra, hidratacao e calendario");
$(w12, "[data-atalho='extra']").click(); await espera(60);
$(w12, "#ex-salvar").click(); await espera(30);
ok(/Falta responder/.test($(w12, "#ex-erro").textContent), "treino extra incompleto: avisa");
$(w12, "[data-tipo='Corrida']").click(); $(w12, "[data-min='5']").click(); $(w12, "[data-expse='6']").click();
digita(w12, $(w12, "#ex-desc"), "5 km leve");
$(w12, "#ex-salvar").click(); await espera(150);
const xs = db.extra_sessions[0];
ok(xs && xs.aluno_id === A && xs.tipo === "Corrida" && xs.duracao_min === 45 && xs.pse === 6 && xs.descricao === "5 km leve", "registra corrida de 45 min, PSE 6");
ok(/Corrida/.test($(w12, "#extra-lista").textContent) && /moderado/.test($(w12, "#extra-lista").textContent), "lista da semana mostra a atividade com rotulo de esforco");

// hidratacao
w12 = await abrir(A); await espera(80);
$(w12, "[data-atalho='agua']").click(); await espera(60);
ok(/2,1 L|2,6 L/.test($(w12, "#agua-corpo").textContent), "meta calculada pelo peso (60 kg × 35 ml, +500 em dia de treino)");
$(w12, "[data-agua='500']").click(); await espera(40); $(w12, "[data-agua='500']").click(); await espera(60);
ok(db.hidratacao[0]?.ml === 1000 && /1 L/.test($(w12, "#agua-ml").textContent), "dois toques de +500 ml gravam 1 L");
$(w12, "#agua-desfazer").click(); await espera(60);
ok(db.hidratacao[0].ml === 500, "desfazer tira o ultimo copo");

// calendario
db.session_logs.push({ id: "calS", aluno_id: A, finalizada: true, data: (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })(), pse: 8, duracao_min: 50, workout_id: iso.id });
pz.inicio = w12.eval("proximaSegunda()"); // plano comeca na proxima segunda
$(w12, "[data-atalho='calendario']").click(); await espera(150);
ok(/Vôlei/.test($(w12, "#cal-plano").textContent) && $$(w12, ".sem-trilho i").length === 12, "calendario mostra o plano com as 12 semanas em rotulos");
ok(!!$(w12, ".cal-grade .dia.hoje.r-alta"), "dia de hoje aparece como treino de intensidade alta (PSE 8)");
ok(!/\bUA\b|ACWR|monotonia|strain/i.test(w12.document.querySelector("#app-aluno").textContent), "aluno segue sem ver UA, ACWR, monotonia ou strain");

// ================= PRONTIDAO NO PAINEL =================
const diaISO = (k) => { const d = new Date(); d.setDate(d.getDate() - k); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
db.checkins = [
  { id: "p1", aluno_id: A, data: diaISO(0), tqr: 8, sono_horas: 5.5, sono_qual: 2, wellness: 2, dor: { lombar: 3, joelho_d: 1 } },
  { id: "p2", aluno_id: A, data: diaISO(1), tqr: 12, sono_horas: 7, sono_qual: 3, wellness: 3, dor: {} },
  { id: "p3", aluno_id: A, data: diaISO(3), tqr: 17, sono_horas: 8, sono_qual: 5, wellness: 4, dor: {} },
];
let w13 = await abrir(T);
w13.__rpc = async () => ({ data: { historico_suficiente: false, dias_7: [], carga_28_dias: [], semanas: [] }, error: null });
await espera(200);
const pr = $(w13, "#tb-prontidao").textContent;
ok(/Ana Aluna/.test(pr) && $(w13, "#tb-prontidao .tqr-cel b").textContent === "8", "painel mostra a prontidao (TQR) de hoje do aluno");
ok(/baixa/.test(pr), "TQR 8 aparece como prontidao baixa");
ok(/▼ -4 vs ontem/.test(pr), "mostra a variacao em relacao a ontem (12 → 8)");
ok(/5,5 h/.test(pr) && /ruim/.test(pr), "mostra sono da noite (5,5 h, ruim)");
ok(/Lombar · forte/.test(pr), "mostra a dor relatada no check-in");
ok($$(w13, "#tb-prontidao .spark i").length === 7, "mini grafico dos ultimos 7 dias");
ok($$(w13, "#tb-prontidao .spark i.vazio").length === 4, "dias sem check-in ficam marcados como vazios");
ok(/1 de 1 fizeram o check-in hoje/.test($(w13, "#pront-sub").textContent) && /prontidao baixa|prontidão baixa/.test($(w13, "#pront-sub").textContent), "resumo diz quantos responderam e quantos estao baixos");
$(w13, "[data-pront]").click(); await espera(200);
ok($(w13, "[data-page='perfil']").classList.contains("on"), "'ver aluno' abre o perfil dele");

// sem check-in hoje
db.checkins = db.checkins.filter((c) => c.data !== diaISO(0));
let w14 = await abrir(T);
w14.__rpc = async () => ({ data: { historico_suficiente: false, dias_7: [], carga_28_dias: [], semanas: [] }, error: null });
await espera(200);
ok(/sem check-in hoje/.test($(w14, "#tb-prontidao").textContent) && /0 de 1/.test($(w14, "#pront-sub").textContent), "quem nao fez check-in aparece como 'sem check-in hoje'");

// ================= MINHA PROGRESSAO (aluno) =================
db.session_logs.push(
  { id: "pg1", aluno_id: A, workout_id: "fixo", finalizada: true, data: "2026-08-10", pse: 6, duracao_min: 50 },
  { id: "pg2", aluno_id: A, workout_id: "fixo", finalizada: true, data: "2026-08-24", pse: 7, duracao_min: 50 },
  { id: "pg3", aluno_id: A, workout_id: "fixo", finalizada: true, data: "2026-09-07", pse: 7, duracao_min: 50 });
db.workout_sets.push(
  { session_id: "pg1", exercise_id: "e1", serie_num: 1, carga_kg: 50, reps: 10, concluida: true },
  { session_id: "pg1", exercise_id: "e1", serie_num: 2, carga_kg: 50, reps: 10, concluida: true },
  { session_id: "pg2", exercise_id: "e1", serie_num: 1, carga_kg: 55, reps: 10, concluida: true },
  { session_id: "pg3", exercise_id: "e1", serie_num: 1, carga_kg: 60, reps: 8, concluida: true },
  { session_id: "pg3", exercise_id: "e1", serie_num: 2, carga_kg: 60, reps: 8, concluida: true });
let w15 = await abrir(A);
ok(!!$(w15, "[data-atalho='progresso']"), "home do aluno tem o atalho 'Minha progressao'");
$(w15, "[data-atalho='progresso']").click(); await espera(250);
const pg = $(w15, "#prog-corpo").textContent;
ok(/Supino reto barra/.test(pg), "abre no exercicio com mais treinos");
ok(/100 kg/.test(pg) && /seu recorde/.test(pg), "mostra a maior carga ja feita como recorde");
ok(/[+-]?\d+%/.test(pg) && /desde o 1º treino/.test(pg), "mostra a variacao percentual desde o primeiro treino");
const nTreinos = new Set(db.workout_sets.filter((x) => x.exercise_id === "e1" && x.concluida &&
  db.session_logs.some((sl) => sl.id === x.session_id && sl.aluno_id === A && sl.finalizada)).map((x) => x.session_id)).size;
ok($$(w15, "#prog-graf svg path[stroke]").length >= 1 && $$(w15, "#prog-lista .hist-item").length === nTreinos,
   "grafico de linha e a lista com um item por treino (" + nTreinos + ")");
ok(/Volume acumulado neste exercício: /.test(pg) && /kg levantados/.test(pg), "mostra o volume acumulado (carga × reps)");
ok(!/\bUA\b|ACWR|monotonia|strain/i.test($(w15, "#app-aluno").textContent), "progressao nao mostra UA, ACWR, monotonia nem strain");
const selProg = $(w15, "#prog-sel");
ok(selProg && selProg.options.length >= 1 && /treino/.test(selProg.options[0].textContent), "seletor lista os exercicios com a contagem de treinos");

// ================= SESSAO AO VIVO (treinador) =================
let w16 = await abrir(T);
w16.__rpc = async () => ({ data: { historico_suficiente: false, dias_7: [], carga_28_dias: [], semanas: [] }, error: null });
// relogio controlado: o app usa new Date() para marcar inicio/fim de cada serie
const DataReal = w16.Date;
w16.__agora = DataReal.now();
w16.Date = class extends DataReal {
  constructor(...a) { if (!a.length) super(w16.__agora); else super(...a); }
  static now() { return w16.__agora; }
};
const anda2 = (seg) => { w16.__agora += seg * 1000; };

db.profiles[1].peso_kg = 60;
const wIso = db.workouts.find((x) => x.nome === "Isometria");
$(w16, "[data-nav='alunos']").click(); await espera(120);
ok(!!$(w16, "#tb-alunos [data-treinar]"), "lista de alunos tem o botao 'Treinar agora'");
$(w16, "#tb-alunos [data-treinar]").click(); await espera(200);
ok(/Treino de Ana/.test($(w16, "#modal h3").textContent) && $$(w16, ".ss-op[data-treino]").length >= 1 && !!$(w16, "[data-livre]"),
   "escolha da sessao: treinos publicados + treino livre");
const opcaoIso = $$(w16, ".ss-op[data-treino]").find((b) => /Isometria/.test(b.textContent)) ?? $(w16, ".ss-op[data-treino]");
opcaoIso.click(); await espera(250);
const sess = db.session_logs[db.session_logs.length - 1];
ok(sess && sess.registrada_por === T && sess.aluno_id === A && !sess.finalizada, "abre a sessao no banco marcando que foi o treinador");
ok($(w16, "[data-page='sessao']").classList.contains("on") && $$(w16, ".ss-ex").length >= 1, "entra na tela da sessao com os exercicios do treino");

// serie 1: comeca, 40 s de trabalho, conclui
$(w16, "[data-ssini='0:0']").click(); await espera(60);
anda2(40);
$(w16, "[data-ssok='0:0']").click(); await espera(150);
const stVivo = db.workout_sets.filter((x) => x.session_id === sess.id);
ok(stVivo.length === 1 && stVivo[0].concluida && stVivo[0].iniciada_em && stVivo[0].concluida_em, "serie 1 gravada com inicio e fim");
// 90 s de descanso, serie 2 de 40 s
anda2(90);
$(w16, "[data-ssini='0:1']").click(); await espera(60);
anda2(40);
$(w16, "[data-ssok='0:1']").click(); await espera(150);
const resumo = $(w16, "#ss-resumo").textContent;
ok(/1:30Tempo de recuperação/.test(resumo), "tempo de recuperacao medido: 1:30 entre as duas series");
const s1 = db.workout_sets.find((x) => x.session_id === sess.id && x.serie_num === 1);
const s2 = db.workout_sets.find((x) => x.session_id === sess.id && x.serie_num === 2);
ok(s2.iniciada_em && (new Date(s2.iniciada_em) - new Date(s1.concluida_em)) === 90000, "descanso real de 90 s guardado nos horarios");

// acrescenta um exercicio de carga x reps e faz 2 series para ver a densidade
$(w16, "#ss-add").click(); await espera(80);
$(w16, "[data-ssnovo='e1']").click(); await espera(120);
ok(/Supino reto barra/.test($(w16, "#ss-lista").textContent), "exercicio acrescentado entra na sessao");
const linhaEx = $$(w16, ".ss-ex").length - 1;
digita(w16, $(w16, "[data-sscampo='" + linhaEx + ":0:carga']"), "50");
digita(w16, $(w16, "[data-sscampo='" + linhaEx + ":0:reps']"), "10");
$(w16, "[data-ssini='" + linhaEx + ":0']").click(); anda2(30); $(w16, "[data-ssok='" + linhaEx + ":0']").click(); await espera(150);
anda2(60);
digita(w16, $(w16, "[data-sscampo='" + linhaEx + ":1:carga']"), "50");
digita(w16, $(w16, "[data-sscampo='" + linhaEx + ":1:reps']"), "8");
$(w16, "[data-ssini='" + linhaEx + ":1']").click(); anda2(30); $(w16, "[data-ssok='" + linhaEx + ":1']").click(); await espera(150);
const r2 = $(w16, "#ss-resumo").textContent;
ok(/900/.test(r2), "volume da sessao: 50×10 + 50×8 = 900 kg");
ok(/360/.test(r2), "densidade = 900 kg ÷ 150 s = 6 kg/s = 360 kg/min");
ok(/2:30Tempo de recuperação/.test(r2), "tempo de recuperacao total: 90 s + 60 s = 2:30");

// finalizar exige PSE
$(w16, "#ss-fim").click(); await espera(80);
$(w16, "#ss-salvar").click(); await espera(80);
ok(/Escolha o esforço/.test($(w16, "#ss-erro").textContent), "nao finaliza sem o PSE do aluno");
ok(/900/.test($(w16, ".ss-fim-resumo").textContent) && /15,0/.test($(w16, ".ss-fim-resumo").textContent), "resumo final traz volume e indice de volume (900 ÷ 60 kg)");
$(w16, "[data-sspse='7']").click();
digita(w16, $(w16, "#ss-obs"), "ombro ok, subiu carga no supino");
$(w16, "#ss-salvar").click(); await espera(250);
ok(sess.finalizada && sess.pse === 7 && sess.obs === "ombro ok, subiu carga no supino", "finaliza com PSE 7, duracao e observacao");
ok($(w16, "[data-page='perfil']").classList.contains("on"), "volta para o perfil do aluno depois de encerrar");
await espera(250);
const tabela = $(w16, "#pf-sessoes").textContent;
ok(/ao vivo/.test(tabela) && /900 kg/.test(tabela) && /360 kg\/min/.test(tabela), "sessao aparece no perfil com volume e densidade");
w16.Date = DataReal;

// ================= PAINEL: alunos ativos + iniciar treino com dupla =================
db.profiles.push({ id: "a2", papel: "aluno", nome: "Bruno Costa", peso_kg: 80, objetivo: "Forca", esporte: "Ciclismo" });
db.students.push({ id: "s2", treinador_id: T, aluno_id: "a2", ativo: true });
db.workouts.push({ id: "w9", treinador_id: T, aluno_id: "a2", nome: "Pernas B", status: "publicado",
  data: new Date().toISOString().slice(0, 10), semanas: 1, sessoes_por_semana: 1,
  estrutura: [{ exercise_id: "e2", nome: "Agachamento livre", descanso_s: 120, series: [{ reps_alvo: "8" }, { reps_alvo: "8" }] }] });

let w17 = await abrir(T);
w17.__rpc = async () => ({ data: { historico_suficiente: false, dias_7: [], carga_28_dias: [], semanas: [] }, error: null });
await espera(200);
ok(!!$(w17, "#card-alunos") && /ver a lista/.test($(w17, "#card-alunos").textContent), "quadro 'Alunos ativos' virou botao");
$(w17, "#card-alunos").click(); await espera(120);
ok($$(w17, "[data-alunoperfil]").length === 2, "abre a lista com os dois alunos");
$$(w17, "[data-alunoperfil]").find((b) => /Bruno/.test(b.textContent)).click(); await espera(300);
ok($(w17, "[data-page='perfil']").classList.contains("on") && /Bruno/.test($(w17, "#pf-nome").textContent),
   "clicar no nome abre o perfil daquele aluno");

$(w17, "[data-nav='dash']").click(); await espera(120);
ok(/Iniciar treino/.test($(w17, "#atalho-treinar").textContent), "atalho do painel se chama 'Iniciar treino'");
$(w17, "#atalho-treinar").click(); await espera(120);
ok($$(w17, "[data-ssaluno]").length === 2 && $(w17, "#ss-al-ok").disabled, "lista os alunos para marcar; 'Continuar' comeca travado");
$$(w17, "[data-ssaluno]").forEach((b) => b.click()); await espera(60);
ok(!$(w17, "#ss-al-ok").disabled && /2 alunos/.test($(w17, "#ss-al-ok").textContent), "marcando dois, o botao libera e conta");
$(w17, "#ss-al-ok").click(); await espera(250);
ok(/Aluno 1 de 2/.test($(w17, "#modal").textContent), "pergunta o treino aluno por aluno");
$(w17, "[data-livre]").click(); await espera(250);
ok(/Aluno 2 de 2/.test($(w17, "#modal").textContent), "treino livre vale como escolha e passa para o proximo");
const opBruno = $$(w17, ".ss-op[data-treino]").find((b) => /Pernas B/.test(b.textContent));
ok(!!opBruno, "o segundo aluno ve os treinos publicados dele");
opBruno.click(); await espera(400);
ok($(w17, "[data-page='sessao']").classList.contains("on") && $$(w17, ".ss-aba").length === 2, "entra na sessao com uma aba por aluno");
const abertasBanco = db.session_logs.filter((x) => !x.finalizada && x.registrada_por === T);
ok(abertasBanco.length === 2 && new Set(abertasBanco.map((x) => x.aluno_id)).size === 2, "abriu uma sessao no banco para cada aluno");

const topo = () => $(w17, "#ss-aluno").textContent;
ok(/Ana/.test(topo()) && /Nenhum exerc/.test($(w17, "#ss-lista").textContent), "abre na primeira aba (treino livre, sem exercicio)");
$$(w17, ".ss-aba")[1].click(); await espera(200);
ok(/Bruno/.test(topo()) && /Agachamento livre/.test($(w17, "#ss-lista").textContent), "trocar de aba mostra o treino do outro aluno");

digita(w17, $(w17, "[data-sscampo='0:0:carga']"), "100");
digita(w17, $(w17, "[data-sscampo='0:0:reps']"), "8");
$(w17, "[data-ssok='0:0']").click(); await espera(250);
ok(/1\/2/.test($$(w17, ".ss-aba")[1].textContent), "a aba mostra quantas series ja foram feitas");
$$(w17, ".ss-aba")[0].click(); await espera(200);
ok(/Ana/.test(topo()) && /Nenhum exerc/.test($(w17, "#ss-lista").textContent) &&
   /^0Séries feitas/.test($(w17, "#ss-resumo").textContent),
   "a aba da Ana continua vazia: os registros do Bruno nao vazam para ela");

$$(w17, ".ss-aba")[1].click(); await espera(200);
$(w17, "#ss-fim").click(); await espera(150);
ok(/Finalizar a sessão de Bruno/.test($(w17, "#modal h3").textContent), "finaliza a sessao do aluno que esta na aba aberta");
$(w17, "[data-sspse='6']").click();
$(w17, "#ss-salvar").click(); await espera(400);
ok($(w17, "[data-page='sessao']").classList.contains("on") && $(w17, "#ss-abas").hidden && /Ana/.test(topo()),
   "encerrando um, a sessao do outro continua aberta");
ok(db.session_logs.find((x) => x.aluno_id === "a2" && x.finalizada && x.pse === 6), "a sessao do Bruno ficou gravada com PSE 6");

$(w17, "#ss-fim").click(); await espera(150);
$(w17, "[data-sspse='4']").click();
$(w17, "#ss-salvar").click(); await espera(400);
ok($(w17, "[data-page='perfil']").classList.contains("on"), "encerrando o ultimo, volta para o perfil do aluno");

console.log("\n" + (falhas.length ? falhas.length + " FALHA(S)" : "TUDO PASSOU"));
process.exit(falhas.length ? 1 : 0);
