import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/* =========================================================
   CONFIGURACAO
   A chave "anon" e publica de proposito: quem protege os dados
   e a RLS no banco, nao o segredo da chave.
   ========================================================= */
const SUPABASE_URL = "https://bqprycsbkwrtxsqmskpw.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJxcHJ5Y3Nia3dydHhzcW1za3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3NDM1MzcsImV4cCI6MjEwNTMxOTUzN30.jqUsjP_L0y4XigvHyCMliLx6g4vP0hWzNGVV1auKAps";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const GRUPOS = ["Todos","Peito","Costas","Ombro","Braços","Pernas","Glúteo","Core","Cardio"];
const PADROES = ["Todos","Empurrar","Puxar","Agachar","Dobradiça","Avanço","Rotação","Anti-rotação","Arremesso","Locomoção","Mobilidade"];
const METODOS = ["normal","bi-set","super-série","drop-set","pirâmide"];
const MAX_VIDEO_MB = 50;

const estado = {
  usuario: null,
  perfil: null,
  alunos: [],
  exercicios: [],
  treino: { id: null, nome: "", itens: [], semanas: 1, freq: 1 },
  filtro: { modo: "grupo", chip: "Todos", busca: "" },
};

const $ = (s, raiz = document) => raiz.querySelector(s);
const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

let toastTimer = null;
function aviso(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast on " + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 3600);
}
const erro = (m) => aviso(m, "ruim");
const bom = (m) => aviso(m, "bom");

function iniciais(nome = "") {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() || "?";
}
const escapar = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function abrirModal(html) {
  $("#modal").innerHTML = html;
  $("#modal-fundo").hidden = false;
  const primeiro = $("#modal input, #modal select, #modal textarea");
  if (primeiro) setTimeout(() => primeiro.focus(), 60);
}
function fecharModal() {
  $("#modal-fundo").hidden = true;
  $("#modal").innerHTML = "";
}
$("#modal-fundo").addEventListener("click", (e) => {
  if (e.target.id === "modal-fundo") fecharModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal-fundo").hidden) fecharModal();
});

async function comTratamento(promessa, oQueFalhou) {
  try {
    const { data, error } = await promessa;
    if (error) {
      console.error(oQueFalhou, error);
      erro(oQueFalhou + ": " + error.message);
      return { ok: false, data: null };
    }
    return { ok: true, data };
  } catch (e) {
    console.error(oQueFalhou, e);
    erro(navigator.onLine ? oQueFalhou + ": " + e.message : "Sem conexão — tente de novo em instantes");
    return { ok: false, data: null };
  }
}

function estadoRede() {
  $("#offline").hidden = navigator.onLine;
}
window.addEventListener("online", () => { estadoRede(); bom("Conexão restabelecida"); });
window.addEventListener("offline", estadoRede);

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#btn-entrar");
  const caixaErro = $("#erro-login");
  caixaErro.hidden = true;
  btn.disabled = true;
  btn.textContent = "Entrando...";

  const email = $("#in-email").value.trim().toLowerCase();
  const senha = $("#in-senha").value;

  const { error } = await sb.auth.signInWithPassword({ email, password: senha });

  btn.disabled = false;
  btn.textContent = "Entrar";

  if (error) {
    const m = (error.message || "").toLowerCase();
    caixaErro.textContent = m.includes("invalid")
      ? "E-mail ou senha incorretos."
      : m.includes("failed to fetch")
      ? "Não consegui falar com o servidor. Confira sua internet."
      : error.message;
    caixaErro.hidden = false;
    return;
  }
  await entrar();
});

$("#btn-esqueci").addEventListener("click", async () => {
  const email = $("#in-email").value.trim().toLowerCase();
  if (!email) return erro("Escreva seu e-mail no campo acima primeiro");
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href });
  if (error) return erro(error.message);
  bom("Se existir conta com esse e-mail, o link de redefinição foi enviado");
});

async function sair() {
  await sb.auth.signOut();
  location.reload();
}
$("#btn-sair").addEventListener("click", sair);
$("#btn-sair-aluno").addEventListener("click", sair);

function mostrarTela(qual) {
  $("#splash").hidden = qual !== "splash";
  $("#tela-login").hidden = qual !== "login";
  $("#app-treinador").hidden = qual !== "treinador";
  $("#app-aluno").hidden = qual !== "aluno";
}

async function entrar() {
  mostrarTela("splash");
  const { data: sessao } = await sb.auth.getSession();
  if (!sessao?.session) return mostrarTela("login");

  estado.usuario = sessao.session.user;

  const r = await comTratamento(
    sb.from("profiles").select("*").eq("id", estado.usuario.id).single(),
    "Não consegui carregar seu perfil"
  );
  if (!r.ok) return mostrarTela("login");
  estado.perfil = r.data;

  if (estado.perfil.papel === "treinador") {
    mostrarTela("treinador");
    await iniciarPainel();
  } else {
    mostrarTela("aluno");
    await iniciarAluno();
  }
}

function irPara(pagina) {
  $$(".page").forEach((p) => p.classList.toggle("on", p.dataset.page === pagina));
  $$(".navitem").forEach((b) => b.classList.toggle("on", b.dataset.nav === pagina));
  $("#main").scrollTo(0, 0);
  window.scrollTo(0, 0);
  if (pagina === "dash") carregarProntidao();
  if (pagina === "biblioteca") desenharBiblioteca();
  if (pagina === "periodizacao" && !$("#per-aluno").options.length) montarPeriodizacao();
}
$$(".navitem").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.nav)));
$$("[data-ir]").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.ir)));

async function iniciarPainel() {
  const primeiro = estado.perfil.nome.split(" ")[0];
  const h = new Date().getHours();
  $("#saudacao").textContent = (h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite") + ", " + primeiro;
  $("#hoje").textContent = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
  });
  $("#side-nome").textContent = estado.perfil.nome;
  $("#side-nome2").textContent = estado.perfil.nome;
  $("#side-iniciais").textContent = iniciais(estado.perfil.nome);

  desenharChips();
  await Promise.all([carregarAlunos(), carregarExercicios()]);
  await carregarResumo();
  carregarProntidao();
  carregarAlertas();
}

async function carregarAlunos() {
  const r = await comTratamento(
    sb.from("students")
      .select("id, ativo, aluno:profiles!students_aluno_id_fkey(id,nome,sexo,peso_kg,objetivo,esporte)")
      .eq("treinador_id", estado.usuario.id)
      .eq("ativo", true),
    "Não consegui carregar seus alunos"
  );
  if (!r.ok) return;
  estado.alunos = (r.data ?? []).map((v) => v.aluno).filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const b = $("#badge-alunos");
  b.textContent = estado.alunos.length;
  b.hidden = estado.alunos.length === 0;
  $("#sub-alunos").textContent =
    estado.alunos.length === 0 ? "Nenhum aluno ainda"
    : estado.alunos.length === 1 ? "1 aluno ativo" : estado.alunos.length + " alunos ativos";

  desenharAlunos();
  desenharSeletorAluno();
}

async function carregarExercicios() {
  const r = await comTratamento(
    sb.from("exercises").select("*").order("nome"),
    "Não consegui carregar a biblioteca"
  );
  if (!r.ok) return;
  estado.exercicios = r.data ?? [];
  const meus = estado.exercicios.filter((e) => e.owner_id).length;
  $("#sub-bib").textContent = estado.exercicios.length + " exercícios · " + meus + " criados por você";
  desenharLib();
}

async function carregarResumo() {
  const r = await comTratamento(
    sb.from("workouts")
      .select("id,nome,data,status,aluno_id")
      .order("criado_em", { ascending: false })
      .limit(8),
    "Não consegui carregar os treinos"
  );
  $("#st-alunos").textContent = estado.alunos.length;
  $("#st-videos").textContent = estado.exercicios.filter((e) => e.video_url).length;

  if (!r.ok) return;
  const treinos = r.data ?? [];

  const { count: pub } = await sb.from("workouts")
    .select("id", { count: "exact", head: true }).eq("status", "publicado");
  const { count: ras } = await sb.from("workouts")
    .select("id", { count: "exact", head: true }).eq("status", "rascunho");
  $("#st-publicados").textContent = pub ?? 0;
  $("#st-rascunhos").textContent = ras ?? 0;

  const nomeDe = (id) => estado.alunos.find((a) => a.id === id)?.nome ?? "-";
  $("#tb-ultimos").innerHTML = treinos.length
    ? treinos.map((t) =>
        "<tr><td><div class='quem-cel'><div class='av'>" + escapar(iniciais(nomeDe(t.aluno_id))) +
        "</div><b>" + escapar(nomeDe(t.aluno_id)) + "</b></div></td><td>" + escapar(t.nome) +
        "</td><td class='mini'>" + new Date(t.data + "T12:00:00").toLocaleDateString("pt-BR") +
        "</td><td><span class='pill " + (t.status === "publicado" ? "verde" : "ambar") + "'>" + t.status +
        "</span></td><td><button class='btn ghost sm' data-editar='" + t.id + "'>abrir</button></td></tr>"
      ).join("")
    : "<tr><td colspan='5' class='vazio'>Nenhum treino ainda. Comece em Prescrever treino.</td></tr>";

  $$("[data-editar]").forEach((b) =>
    b.addEventListener("click", () => abrirTreino(b.dataset.editar)));
}

function desenharAlunos() {
  const tb = $("#tb-alunos");
  if (!estado.alunos.length) {
    tb.innerHTML = "<tr><td colspan='6' class='vazio'>Nenhum aluno cadastrado. Clique em + Novo aluno.</td></tr>";
    return;
  }
  tb.innerHTML = estado.alunos.map((a) =>
    "<tr><td><div class='quem-cel'><div class='av'>" + escapar(iniciais(a.nome)) + "</div><b>" +
    escapar(a.nome) + "</b></div></td><td class='mini'>" + escapar(a.objetivo ?? "-") +
    "</td><td class='mini'>" + escapar(a.esporte ?? "-") + "</td><td class='mini'>" +
    (a.peso_kg ? a.peso_kg + " kg" : "-") + "</td><td class='mini' data-contagem='" + a.id +
    "'>-</td><td class='acoes-linha'><button class='btn ghost sm' data-perfil='" + a.id + "'>ver carga</button> " +
    "<button class='btn ghost sm' data-prescrever='" + a.id + "'>prescrever</button></td></tr>"
  ).join("");

  $$("[data-prescrever]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#sel-aluno").value = b.dataset.prescrever;
      irPara("prescrever");
    }));

  ligarPerfis();
  contarTreinosPorAluno();
}

async function contarTreinosPorAluno() {
  const r = await sb.from("workouts").select("aluno_id");
  if (r.error) return;
  const cont = {};
  (r.data ?? []).forEach((w) => (cont[w.aluno_id] = (cont[w.aluno_id] ?? 0) + 1));
  $$("[data-contagem]").forEach((td) => {
    const n = cont[td.dataset.contagem] ?? 0;
    td.textContent = n === 0 ? "nenhum" : n === 1 ? "1 treino" : n + " treinos";
  });
}

function desenharSeletorAluno() {
  const sel = $("#sel-aluno");
  const antes = sel.value;
  sel.innerHTML = estado.alunos.length
    ? estado.alunos.map((a) => "<option value='" + a.id + "'>" + escapar(a.nome) + "</option>").join("")
    : "<option value=''>- cadastre um aluno primeiro -</option>";
  if (antes && estado.alunos.some((a) => a.id === antes)) sel.value = antes;
}

$("#atalho-novo-aluno").addEventListener("click", () => { irPara("alunos"); $("#btn-novo-aluno").click(); });
$("#btn-novo-aluno").addEventListener("click", () => {
  abrirModal(
    "<h3>Novo aluno</h3><p class='desc'>Eu crio a conta e gero uma senha temporária para você passar ao aluno.</p>" +
    "<form id='form-aluno'>" +
    "<label class='campo'><span>Nome completo *</span><input id='a-nome' required></label>" +
    "<label class='campo'><span>E-mail *</span><input id='a-email' type='email' required placeholder='aluno@email.com'></label>" +
    "<div class='linha'><label class='campo'><span>Sexo</span><select id='a-sexo'><option value=''>-</option><option value='F'>Feminino</option><option value='M'>Masculino</option><option value='outro'>Outro</option></select></label>" +
    "<label class='campo'><span>Peso (kg)</span><input id='a-peso' type='number' step='0.1' min='20' max='300' inputmode='decimal'></label></div>" +
    "<div class='linha'><label class='campo'><span>Objetivo</span><input id='a-objetivo' placeholder='Hipertrofia, emagrecimento...'></label>" +
    "<label class='campo'><span>Esporte</span><input id='a-esporte' placeholder='Corrida, ciclismo...'></label></div>" +
    "<div id='a-erro' class='erro' hidden></div>" +
    "<div class='acoes'><button type='button' class='btn ghost' id='a-cancelar'>Cancelar</button>" +
    "<button type='submit' class='btn' id='a-salvar'>Criar conta do aluno</button></div></form>");

  $("#a-cancelar").addEventListener("click", fecharModal);
  $("#form-aluno").addEventListener("submit", criarAluno);
});

async function criarAluno(e) {
  e.preventDefault();
  const btn = $("#a-salvar");
  const cErro = $("#a-erro");
  cErro.hidden = true;
  btn.disabled = true;
  btn.textContent = "Criando...";

  const corpo = {
    nome: $("#a-nome").value.trim(),
    email: $("#a-email").value.trim().toLowerCase(),
    sexo: $("#a-sexo").value,
    peso_kg: $("#a-peso").value,
    objetivo: $("#a-objetivo").value.trim(),
    esporte: $("#a-esporte").value.trim(),
  };

  try {
    const { data, error } = await sb.functions.invoke("criar-aluno", { body: corpo });
    let payload = data;
    if (error) {
      try { payload = await error.context.json(); } catch { payload = null; }
      throw new Error(payload?.erro ?? error.message);
    }
    fecharModal();
    await carregarAlunos();
    await carregarResumo();
    mostrarCredenciais(payload);
  } catch (err) {
    cErro.textContent = err.message || "Não consegui criar a conta";
    cErro.hidden = false;
    btn.disabled = false;
    btn.textContent = "Criar conta do aluno";
  }
}

function mostrarCredenciais(d) {
  abrirModal(
    "<h3>Conta criada</h3><p class='desc'>Passe estes dados para " + escapar(d.nome) +
    ". A senha aparece só desta vez.</p><div class='credencial'>" +
    "<div><span>E-mail</span><b>" + escapar(d.email) + "</b></div>" +
    "<div><span>Senha temporária</span><b>" + escapar(d.senha_temporaria) + "</b></div></div>" +
    "<div class='acoes'><button class='btn ghost' id='c-copiar'>Copiar</button>" +
    "<button class='btn' id='c-fechar'>Pronto</button></div>");
  $("#c-fechar").addEventListener("click", fecharModal);
  $("#c-copiar").addEventListener("click", async () => {
    const txt = "LOADSTRAT\nE-mail: " + d.email + "\nSenha: " + d.senha_temporaria;
    try {
      await navigator.clipboard.writeText(txt);
      bom("Copiado");
    } catch { erro("Seu navegador bloqueou a cópia — anote manualmente"); }
  });
}

function desenharChips() {
  const lista = estado.filtro.modo === "grupo" ? GRUPOS : PADROES;
  $("#chips").innerHTML = lista
    .map((g) => "<button class='chip " + (g === estado.filtro.chip ? "on" : "") + "' data-chip='" + escapar(g) + "'>" + escapar(g) + "</button>")
    .join("");
  $$("[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.filtro.chip = b.dataset.chip;
      desenharChips();
      desenharLib();
    }));
}
$$(".fmode button").forEach((b) =>
  b.addEventListener("click", () => {
    estado.filtro.modo = b.dataset.modo;
    estado.filtro.chip = "Todos";
    $$(".fmode button").forEach((x) => x.classList.toggle("on", x === b));
    desenharChips();
    desenharLib();
  }));
$("#in-busca-lib").addEventListener("input", (e) => {
  estado.filtro.busca = e.target.value.toLowerCase();
  desenharLib();
});

function normalizar(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function exerciciosFiltrados() {
  const { modo, chip, busca } = estado.filtro;
  return estado.exercicios.filter((ex) => {
    const campo = modo === "grupo" ? ex.grupo : ex.padrao;
    const okChip = chip === "Todos" || normalizar(campo) === normalizar(chip);
    const okBusca = !busca || normalizar(ex.nome).includes(normalizar(busca));
    return okChip && okBusca;
  });
}

function desenharLib() {
  const lista = exerciciosFiltrados();
  $("#liblist").innerHTML = lista.length
    ? lista.map((ex) => {
        const dentro = estado.treino.itens.some((i) => i.exercise_id === ex.id);
        return "<button class='libitem " + (dentro ? "dentro" : "") + "' data-add='" + ex.id + "'>" +
          "<div class='th " + (ex.video_url ? "" : "semvideo") + "'><svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z'/></svg></div>" +
          "<div><b>" + escapar(ex.nome) + "</b><div class='m'>" + escapar(ex.grupo ?? "-") + " - " + escapar(ex.padrao ?? "-") + "</div></div>" +
          "<div class='plus'>" + (dentro ? "\u2713" : "+") + "</div></button>";
      }).join("")
    : "<p class='vazio'>Nenhum exercício com esse filtro.<br><button class='link-sutil' id='criar-da-busca'>Criar \"" +
      escapar(estado.filtro.busca || "novo exercício") + "\"</button></p>";
  $("#criar-da-busca")?.addEventListener("click", () =>
    abrirExercicio({ nome: $("#in-busca-lib").value.trim(), aoCriar: (ex) => adicionarExercicio(ex.id) }));

  $$("[data-add]").forEach((b) =>
    b.addEventListener("click", () => adicionarExercicio(b.dataset.add)));
}

function adicionarExercicio(id) {
  const ex = estado.exercicios.find((e) => e.id === id);
  if (!ex) return;
  if (estado.treino.itens.some((i) => i.exercise_id === id))
    return aviso(ex.nome + " já está no treino");

  estado.treino.itens.push({
    exercise_id: ex.id,
    nome: ex.nome,
    registro: "carga_reps",
    metodo: "normal",
    descanso_s: 90,
    series: [novaSerie(), novaSerie(), novaSerie()],
  });
  desenharTreino();
  desenharLib();
}
/* ---------- como cada exercício é registrado NESTA prescrição ----------
   O mesmo agachamento pode ser carga × reps num treino e carga × tempo em outro. */
const CAMPOS = {
  carga: { rot: "Carga (kg)", curto: "Carga kg", alvo: "carga_alvo", onda: "carga", set: "carga_kg", modo: "decimal" },
  reps:  { rot: "Reps", curto: "Reps", alvo: "reps_alvo", onda: "reps", set: "reps", modo: "numeric" },
  tempo: { rot: "Tempo (s)", curto: "Tempo", alvo: "tempo_alvo", onda: "tempo", set: "tempo_s", modo: "text" },
  dist:  { rot: "Distância (m)", curto: "Metros", alvo: "dist_alvo", onda: "dist", set: "dist_m", modo: "decimal" },
};
const REGISTROS = {
  carga_reps:  { rot: "Carga × reps", campos: ["carga", "reps"] },
  carga_tempo: { rot: "Carga × tempo", campos: ["carga", "tempo"] },
  carga_dist:  { rot: "Carga × distância", campos: ["carga", "dist"] },
  reps:        { rot: "Só reps (peso corporal)", campos: ["reps"] },
  tempo:       { rot: "Só tempo", campos: ["tempo"] },
};
const registroDe = (item) => REGISTROS[item?.registro] ? item.registro : (item?.categoria === "tempo" ? "tempo" : "carga_reps");
const camposDe = (item) => REGISTROS[registroDe(item)].campos;
const novaSerie = () => ({ carga_alvo: "", reps_alvo: "", tempo_alvo: "", dist_alvo: "" });
const copiaSerie = (u) => ({ carga_alvo: u?.carga_alvo ?? "", reps_alvo: u?.reps_alvo ?? "", tempo_alvo: u?.tempo_alvo ?? "", dist_alvo: u?.dist_alvo ?? "" });

/* tempo: aceita 45, 45s, 1:30, 1'30 ou 2min */
function segundos(txt) {
  const t = String(txt ?? "").trim().toLowerCase().replace(",", ".");
  if (!t) return null;
  let m = t.match(/^(\d+)\s*[:']\s*(\d{1,2})"?$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = t.match(/^(\d+(?:\.\d+)?)\s*(min|m)$/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = t.match(/^(\d+)\s*s?$/);
  return m ? parseInt(m[1]) : null;
}
function fmtTempo(seg) {
  if (seg == null || seg === "") return "";
  const n = typeof seg === "number" ? seg : segundos(seg);
  if (n == null) return String(seg);
  return n < 60 ? n + "s" : Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}
/* descreve uma série registrada, com o que tiver: "20 kg × 10", "20 kg · 45s", "30 m" */
function descreverSerie(x) {
  const kg = x.carga_kg != null && x.carga_kg !== "" ? fmtNum(x.carga_kg) + " kg" : "";
  const partes = [];
  if (x.reps != null && x.reps !== "") partes.push((kg ? kg + " × " : "") + x.reps + (kg ? "" : " reps"));
  else if (kg) partes.push(kg);
  if (x.tempo_s != null) partes.push(fmtTempo(x.tempo_s));
  if (x.dist_m != null) partes.push(fmtNum(x.dist_m) + " m");
  return partes.join(" · ") || "—";
}
const fmtNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : String(v); };

function desenharTreino() {
  const alvo = $("#lista-ex");
  $("#vazio-treino").hidden = estado.treino.itens.length > 0;

  alvo.innerHTML = estado.treino.itens.map((item, i) => {
    const campos = camposDe(item);
    const ondulado = estado.treino.semanas > 1;
    const linhas = ondulado ? "" : item.series.map((s, j) =>
      "<tr><td class='sn'>" + (j + 1) + "</td>" +
      campos.map((k) => "<td><input value='" + escapar(s[CAMPOS[k].alvo] ?? "") + "' placeholder='" + (k === "tempo" ? "ex.: 45 ou 1:30" : "-") +
        "' inputmode='" + CAMPOS[k].modo + "' data-campo='" + CAMPOS[k].alvo + "' data-i='" + i + "' data-j='" + j + "'></td>").join("") +
      "<td><button class='rm' data-rmserie='" + i + ":" + j + "' title='Remover série'>×</button></td></tr>"
    ).join("");

    return "<div class='exblock'><div class='exhd'>" +
      "<button class='mover' data-subir='" + i + "' title='Subir'" + (i === 0 ? " disabled" : "") + ">↑</button>" +
      "<button class='mover' data-descer='" + i + "' title='Descer'" + (i === estado.treino.itens.length - 1 ? " disabled" : "") + ">↓</button>" +
      "<span class='nm'>" + escapar(item.nome) + "</span>" +
      "<select data-registro='" + i + "' title='Como o aluno registra este exercício neste treino'>" +
      Object.entries(REGISTROS).map(([k, r]) => "<option value='" + k + "'" + (registroDe(item) === k ? " selected" : "") + ">" + r.rot + "</option>").join("") +
      "</select>" +
      "<select data-metodo='" + i + "'>" +
      METODOS.map((m) => "<option" + (item.metodo === m ? " selected" : "") + ">" + m + "</option>").join("") +
      "</select><button class='del' data-rmex='" + i + "' title='Remover exercício'>×</button></div>" +
      "<div class='exbd'>" + (ondulado ? tabelaOndas(item, i) :
      "<table class='setgrid'><thead><tr><th style='width:34px'>#</th>" +
      campos.map((k) => "<th>" + CAMPOS[k].rot + "</th>").join("") +
      "<th style='width:34px'></th></tr></thead><tbody>" + linhas + "</tbody></table>" +
      "<button class='btn ghost sm' data-addserie='" + i + "' style='margin-top:8px'>+ Série</button>") +
      "<div class='rest-in'>Descanso <input value='" + item.descanso_s + "' inputmode='numeric' data-descanso='" + i + "'> seg</div></div></div>";
  }).join("");

  $$("[data-campo]").forEach((inp) =>
    inp.addEventListener("input", () => {
      const { i, j, campo } = inp.dataset;
      estado.treino.itens[+i].series[+j][campo] = inp.value;
      calcularResumoTreino();
    }));
  $$("[data-metodo]").forEach((s) =>
    s.addEventListener("change", () => { estado.treino.itens[+s.dataset.metodo].metodo = s.value; }));
  $$("[data-registro]").forEach((s) =>
    s.addEventListener("change", () => { estado.treino.itens[+s.dataset.registro].registro = s.value; desenharTreino(); }));
  $$("[data-descanso]").forEach((inp) =>
    inp.addEventListener("input", () => {
      estado.treino.itens[+inp.dataset.descanso].descanso_s = inp.value;
      calcularResumoTreino();
    }));
  $$("[data-addserie]").forEach((b) =>
    b.addEventListener("click", () => {
      const it = estado.treino.itens[+b.dataset.addserie];
      const ult = it.series[it.series.length - 1];
      it.series.push(copiaSerie(ult));
      desenharTreino();
    }));
  $$("[data-rmserie]").forEach((b) =>
    b.addEventListener("click", () => {
      const partes = b.dataset.rmserie.split(":").map(Number);
      const i = partes[0], j = partes[1];
      estado.treino.itens[i].series.splice(j, 1);
      if (!estado.treino.itens[i].series.length) estado.treino.itens[i].series.push(novaSerie());
      desenharTreino();
    }));
  $$("[data-rmex]").forEach((b) =>
    b.addEventListener("click", () => {
      estado.treino.itens.splice(+b.dataset.rmex, 1);
      desenharTreino(); desenharLib();
    }));
  $$("[data-subir]").forEach((b) =>
    b.addEventListener("click", () => trocar(+b.dataset.subir, +b.dataset.subir - 1)));
  $$("[data-descer]").forEach((b) =>
    b.addEventListener("click", () => trocar(+b.dataset.descer, +b.dataset.descer + 1)));

  $$("[data-onda]").forEach((inp) =>
    inp.addEventListener("input", () => {
      const [i, w, campo] = inp.dataset.onda.split(":");
      estado.treino.itens[+i].ondas[+w][campo] = campo === "series"
        ? Math.max(1, Math.min(12, parseInt(inp.value) || 1)) : inp.value;
      calcularResumoTreino();
    }));
  $$("[data-aplicar]").forEach((b) =>
    b.addEventListener("click", () => {
      const base = estado.treino.itens[+b.dataset.aplicar].ondas;
      estado.treino.itens.forEach((it) => {
        it.ondas = base.map((o) => ({ series: o.series, reps: o.reps ?? "", tempo: o.tempo ?? "", dist: o.dist ?? "",
          carga: it === estado.treino.itens[+b.dataset.aplicar] ? o.carga : "" }));
      });
      desenharTreino();
      bom("Esquema de semanas copiado para todos os exercícios");
    }));

  calcularResumoTreino();
}

/* ---------- ondulação semanal ---------- */
function tabelaOndas(item, i) {
  garantirOndas(item);
  // ordem na tabela: volume (reps/tempo/distância) primeiro, carga por último
  const campos = camposDe(item).slice().sort((a, b) => (a === "carga") - (b === "carga"));
  const linhas = item.ondas.map((o, w) =>
    "<tr><td class='sn'>S" + (w + 1) + "</td>" +
    "<td><input value='" + escapar(o.series) + "' inputmode='numeric' data-onda='" + i + ":" + w + ":series'></td>" +
    campos.map((k) => "<td><input value='" + escapar(o[CAMPOS[k].onda] ?? "") + "' placeholder='-' inputmode='" + CAMPOS[k].modo +
      "' data-onda='" + i + ":" + w + ":" + CAMPOS[k].onda + "'></td>").join("") + "</tr>"
  ).join("");
  return "<table class='setgrid'><thead><tr><th style='width:40px'>Sem.</th><th>Séries</th>" +
    campos.map((k) => "<th>" + CAMPOS[k].rot + "</th>").join("") +
    "</tr></thead><tbody>" + linhas + "</tbody></table>" +
    (estado.treino.itens.length > 1
      ? "<button class='btn ghost sm' data-aplicar='" + i + "' style='margin-top:8px'>Aplicar este esquema a todos</button>" : "");
}

function garantirOndas(item) {
  const n = estado.treino.semanas;
  if (!Array.isArray(item.ondas) || !item.ondas.length) {
    const s0 = item.series?.[0] ?? {};
    item.ondas = [{ series: item.series?.length || 3, reps: s0.reps_alvo ?? "", carga: s0.carga_alvo ?? "",
      tempo: s0.tempo_alvo ?? "", dist: s0.dist_alvo ?? "" }];
  }
  while (item.ondas.length < n) {
    const u = item.ondas[item.ondas.length - 1];
    item.ondas.push({ ...u });
  }
  if (item.ondas.length > n) item.ondas.length = n;
}

function configurarOndas() {
  estado.treino.semanas = parseInt($("#sel-semanas").value) || 1;
  estado.treino.freq = parseInt($("#sel-freq").value) || 1;
  if (estado.treino.semanas > 1) estado.treino.itens.forEach(garantirOndas);
  $("#onda-dica").textContent = estado.treino.semanas > 1
    ? "A semana avança a cada " + estado.treino.freq + (estado.treino.freq === 1 ? " treino concluído" : " treinos concluídos") + " pelo aluno."
    : "Séries fixas — escolha mais de 1 semana para ondular.";
  desenharTreino();
}

function trocar(a, b) {
  const it = estado.treino.itens;
  if (b < 0 || b >= it.length) return;
  const tmp = it[a]; it[a] = it[b]; it[b] = tmp;
  desenharTreino();
}

function calcularResumoTreino() {
  let series = 0, seg = 0;
  estado.treino.itens.forEach((it) => {
    const n = estado.treino.semanas > 1 && it.ondas?.length ? (parseInt(it.ondas[0].series) || 0) : it.series.length;
    series += n;
    seg += n * ((parseInt(it.descanso_s) || 0) + 45);
  });
  $("#s-ex").textContent = estado.treino.itens.length;
  $("#s-series").textContent = series;
  $("#s-tempo").textContent = Math.round(seg / 60) + "min";
}

$("#in-nome-treino").addEventListener("input", (e) => { estado.treino.nome = e.target.value; });

async function salvarTreino(status) {
  const alunoId = $("#sel-aluno").value;
  if (!alunoId) return erro("Cadastre um aluno antes de prescrever");
  if (!estado.treino.itens.length) return erro("Adicione ao menos um exercício");

  const nome = ($("#in-nome-treino").value || "").trim() ||
    ("Treino de " + new Date().toLocaleDateString("pt-BR"));

  const registro = {
    treinador_id: estado.usuario.id,
    aluno_id: alunoId,
    nome,
    estrutura: estado.treino.itens.map((it) => {
      if (estado.treino.semanas > 1 && it.ondas?.length) {
        const o = it.ondas[0];
        return { ...it, ondas: it.ondas.slice(0, estado.treino.semanas),
          series: Array.from({ length: parseInt(o.series) || 1 }, () => ondaParaSerie(o)) };
      }
      const { ondas, ...resto } = it;
      return resto;
    }),
    semanas: estado.treino.semanas,
    sessoes_por_semana: estado.treino.freq,
    status,
  };

  const botoes = [$("#btn-rascunho"), $("#btn-publicar")];
  botoes.forEach((b) => (b.disabled = true));

  const r = estado.treino.id
    ? await comTratamento(
        sb.from("workouts").update(registro).eq("id", estado.treino.id).select().single(),
        "Não consegui salvar o treino")
    : await comTratamento(
        sb.from("workouts").insert(registro).select().single(),
        "Não consegui salvar o treino");

  botoes.forEach((b) => (b.disabled = false));
  if (!r.ok) return;

  const conf = await comTratamento(
    sb.from("workouts").select("id,nome,status,estrutura").eq("id", r.data.id).single(),
    "Salvei, mas não consegui reler para confirmar");
  if (!conf.ok) return;

  const qtd = Array.isArray(conf.data.estrutura) ? conf.data.estrutura.length : 0;
  estado.treino.id = conf.data.id;

  bom(status === "publicado"
    ? "Publicado para " + nomeAluno(alunoId) + " - " + qtd + " exercícios"
    : "Rascunho salvo - " + qtd + " exercícios");

  await carregarResumo();
  if (status === "publicado") limparTreino();
}

const nomeAluno = (id) => estado.alunos.find((a) => a.id === id)?.nome ?? "o aluno";

function limparTreino() {
  estado.treino = { id: null, nome: "", itens: [], semanas: 1, freq: 1 };
  $("#in-nome-treino").value = "";
  $("#sel-semanas").value = "1";
  $("#sel-freq").value = "1";
  configurarOndas();
  desenharTreino();
  desenharLib();
}

async function abrirTreino(id) {
  const r = await comTratamento(
    sb.from("workouts").select("*").eq("id", id).single(),
    "Não consegui abrir o treino");
  if (!r.ok) return;
  estado.treino = {
    id: r.data.id,
    nome: r.data.nome,
    itens: Array.isArray(r.data.estrutura) ? r.data.estrutura : [],
    semanas: r.data.semanas || 1,
    freq: r.data.sessoes_por_semana || 1,
  };
  $("#in-nome-treino").value = r.data.nome;
  $("#sel-semanas").value = String(estado.treino.semanas);
  $("#sel-freq").value = String(estado.treino.freq);
  $("#sel-aluno").value = r.data.aluno_id;
  irPara("prescrever");
  configurarOndas();
  desenharLib();
}

$("#btn-rascunho").addEventListener("click", () => salvarTreino("rascunho"));
$("#sel-semanas").innerHTML = Array.from({ length: 12 }, (_, k) =>
  "<option value='" + (k + 1) + "'>" + (k + 1) + (k ? " semanas" : " semana") + "</option>").join("");
$("#sel-freq").innerHTML = Array.from({ length: 7 }, (_, k) =>
  "<option value='" + (k + 1) + "'>" + (k + 1) + "x por semana</option>").join("");
$("#sel-semanas").addEventListener("change", configurarOndas);
$("#sel-freq").addEventListener("change", configurarOndas);
$("#btn-publicar").addEventListener("click", () => salvarTreino("publicado"));

$("#in-busca-bib").addEventListener("input", desenharBiblioteca);
$("#ck-meus").addEventListener("change", desenharBiblioteca);
$("#ck-sem-video").addEventListener("change", desenharBiblioteca);

function desenharBiblioteca() {
  const busca = ($("#in-busca-bib").value || "").toLowerCase();
  const soMeus = $("#ck-meus").checked;
  const semVideo = $("#ck-sem-video").checked;

  const lista = estado.exercicios.filter((ex) =>
    (!busca || normalizar(ex.nome).includes(normalizar(busca))) &&
    (!soMeus || !!ex.owner_id) &&
    (!semVideo || !ex.video_url));

  $("#grid-bib").innerHTML = lista.length
    ? lista.map((ex) =>
      "<div class='card-ex'><div class='thumb'>" +
      (ex.video_url ? midiaVideo(ex.video_url) : "<div class='semvid'>sem vídeo</div>") +
      (ehYoutube(ex.video_url) ? "<span class='tag-yt'>YouTube</span>" : "") +
      (ex.owner_id ? "<span class='tag-meu'>meu</span>" : "") +
      "</div><div class='info'><b>" + escapar(ex.nome) + "</b><div class='mini'>" +
      escapar(ex.grupo ?? "-") + " · " + escapar(ex.padrao ?? "-") +
      "</div></div><div class='acoes-ex'>" +
      (ex.owner_id
        ? "<button class='btn ghost sm' data-editar='" + ex.id + "'>Editar" + (ex.video_url ? "" : " · pôr vídeo") + "</button>"
        : "<button class='btn ghost sm' data-copiar='" + ex.id + "'>" + (ex.video_url ? "Usar meu vídeo" : "Adicionar vídeo") + "</button>") +
      (ex.owner_id ? "<button class='btn perigo sm' data-apagar='" + ex.id + "'>Apagar</button>" : "") +
      "</div></div>").join("")
    : "<p class='vazio'>Nenhum exercício com esse filtro.</p>";

  protegerVideos($("#grid-bib"));
  $$("[data-editar]").forEach((b) =>
    b.addEventListener("click", () => abrirExercicio({ id: b.dataset.editar })));
  $$("[data-copiar]").forEach((b) =>
    b.addEventListener("click", () => abrirExercicio({ base: b.dataset.copiar })));
  $$("[data-apagar]").forEach((b) =>
    b.addEventListener("click", () => apagarExercicio(b.dataset.apagar)));
}

/* =========================================================
   EXERCÍCIO: criar / editar, com vídeo do YouTube ou do aparelho
   No banco fica só o endereço: link canônico do YouTube ou
   o endereço público do arquivo no Storage.
   ========================================================= */
function idYoutube(texto) {
  const t = String(texto ?? "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  let u;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : "https://" + t); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = u.searchParams.get("v");
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    if (!id && m) id = m[2];
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}
const urlYoutube = (id) => "https://www.youtube.com/watch?v=" + id;
const ehYoutube = (url) => /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(url ?? "");
const ehDoStorage = (url) => /\/storage\/v1\/object\/public\/exercise-videos\//.test(url ?? "");

/* player único para biblioteca, execução do aluno e prévia */
function midiaVideo(url, classe = "") {
  if (!url) return "";
  if (ehYoutube(url)) {
    const id = url.slice(-11);
    return "<div class='yt " + classe + "'><iframe src='https://www.youtube-nocookie.com/embed/" + id +
      "?rel=0&modestbranding=1&playsinline=1' title='Vídeo do exercício' loading='lazy' " +
      "allow='accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen' allowfullscreen></iframe></div>";
  }
  return "<video class='" + classe + "' src='" + escapar(url) + "' controls preload='metadata' playsinline></video>";
}

function validarArquivoVideo(arquivo) {
  if (!arquivo) return "Escolha um vídeo.";
  const mb = arquivo.size / 1048576;
  if (mb > MAX_VIDEO_MB)
    return "Esse vídeo tem " + mb.toFixed(0) + " MB e o limite é " + MAX_VIDEO_MB + " MB. " +
      "Grave em 720p (já basta para demonstração), corte o trecho essencial — ou poste no YouTube e cole o link.";
  const ext = (arquivo.name.split(".").pop() || "").toLowerCase();
  const tipoOk = /^video\/(mp4|quicktime|webm)$/.test(arquivo.type) || (!arquivo.type && ["mp4", "mov", "webm"].includes(ext));
  if (!tipoOk) return "Formato não aceito (" + (arquivo.type || ext || "desconhecido") + "). Use MP4, MOV ou WEBM — ou cole um link do YouTube.";
  return null;
}
function tipoDoArquivo(arquivo) {
  if (arquivo.type) return arquivo.type;
  const ext = (arquivo.name.split(".").pop() || "").toLowerCase();
  return ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4";
}

/* sobe o arquivo e devolve o endereço público (ou null se falhou) */
async function subirVideo(arquivo, aoProgresso) {
  const tipo = tipoDoArquivo(arquivo);
  const ext = tipo === "video/quicktime" ? "mov" : tipo === "video/webm" ? "webm" : "mp4";
  const caminho = estado.usuario.id + "/" + crypto.randomUUID() + "." + ext;
  aoProgresso?.(15, "Enviando " + (arquivo.size / 1048576).toFixed(1) + " MB…");
  const up = await comTratamento(
    sb.storage.from("exercise-videos").upload(caminho, arquivo, { contentType: tipo, upsert: false }),
    "Falha no envio do vídeo");
  if (!up.ok) return null;
  aoProgresso?.(75, "Registrando…");
  const { data: pub } = sb.storage.from("exercise-videos").getPublicUrl(caminho);
  return { url: pub.publicUrl, caminho };
}
function caminhoNoStorage(url) {
  const m = String(url ?? "").match(/\/exercise-videos\/(.+)$/);
  return m ? m[1] : null;
}

const ex_ = { modo: "nenhum", aoCriar: null };

/*
  abrirExercicio({ id })          editar um exercício meu
  abrirExercicio({ base })        criar cópia minha de um exercício da biblioteca padrão
  abrirExercicio({ aoCriar, nome }) criar novo (aoCriar recebe o exercício salvo)
*/
function abrirExercicio(op = {}) {
  const ed = op.id ? estado.exercicios.find((e) => e.id === op.id) : null;
  const base = op.base ? estado.exercicios.find((e) => e.id === op.base) : null;
  const d = ed ?? base ?? { nome: op.nome ?? "", grupo: GRUPOS[1], padrao: PADROES[1], categoria: "forca", obs: "" };
  ex_.id = ed?.id ?? null;
  ex_.antigo = ed?.video_url ?? null;
  ex_.aoCriar = op.aoCriar ?? null;
  ex_.modo = ed?.video_url ? "manter" : "youtube";

  const opt = (lista, atual) => lista.filter((g) => g !== "Todos")
    .map((g) => "<option" + (g === atual ? " selected" : "") + ">" + escapar(g) + "</option>").join("");
  const titulo = ed ? "Editar exercício" : base ? "Minha versão de " + escapar(base.nome) : "Novo exercício";
  const desc = base ? "O exercício da biblioteca padrão não pode ser alterado — vou criar uma cópia sua, com o seu vídeo."
    : "Fica só na sua biblioteca e dos seus alunos — nenhum outro treinador vê.";

  abrirModal(
    "<h3>" + titulo + "</h3><p class='desc'>" + desc + "</p>" +
    "<form id='form-ex' novalidate><label class='campo'><span>Nome *</span><input id='e-nome' required maxlength='80' value='" + escapar(d.nome) + "' placeholder='Ex.: Agachamento búlgaro'></label>" +
    "<div class='campo'><span>Vídeo demonstrativo</span>" +
    "<div class='vid-modos'>" +
    (ed?.video_url ? "<button type='button' data-vmodo='manter'>Manter atual</button>" : "") +
    "<button type='button' data-vmodo='youtube'><svg viewBox='0 0 24 24'><path d='M23 7.2a3 3 0 00-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 001 7.2 31 31 0 00.6 12a31 31 0 00.4 4.8 3 3 0 002.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 002.1-2.1 31 31 0 00.4-4.8 31 31 0 00-.4-4.8zM9.7 15.1V8.9l5.8 3.1z' fill='currentColor'/></svg>Link do YouTube</button>" +
    "<button type='button' data-vmodo='arquivo'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='6' y='2' width='12' height='20' rx='2.5'/><path d='M11 18h2'/></svg>Do celular</button>" +
    "<button type='button' data-vmodo='nenhum'>" + (ed?.video_url ? "Remover" : "Sem vídeo") + "</button></div>" +

    "<div class='vid-painel' data-vpainel='manter'>" + midiaVideo(ed?.video_url, "vid-prev") + "</div>" +
    "<div class='vid-painel' data-vpainel='youtube'><input id='e-yt' inputmode='url' autocomplete='off' placeholder='Cole aqui o link (vídeo ou Shorts)'>" +
    "<div class='mini vid-dica'>No YouTube: Compartilhar → Copiar link. Vídeos \"não listados\" também funcionam.</div><div id='e-yt-prev'></div></div>" +
    "<div class='vid-painel' data-vpainel='arquivo'><label class='soltar'><input type='file' id='e-arquivo' accept='video/mp4,video/quicktime,video/webm,video/*'>" +
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 16V4M7 9l5-5 5 5'/><path d='M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3'/></svg>" +
    "<b id='e-arq-nome'>Escolher ou gravar vídeo</b><span>MP4, MOV ou WEBM · até " + MAX_VIDEO_MB + " MB</span></label><div id='e-arq-prev'></div></div>" +
    "<div class='vid-painel' data-vpainel='nenhum'><div class='mini'>" + (ed?.video_url ? "O vídeo atual será removido ao salvar." : "Dá para adicionar depois, em Biblioteca → Editar.") + "</div></div>" +
    "</div>" +

    "<div class='linha'><label class='campo'><span>Grupo muscular</span><select id='e-grupo'>" + opt(GRUPOS, d.grupo) + "</select></label>" +
    "<label class='campo'><span>Padrão de movimento</span><select id='e-padrao'>" + opt(PADROES, d.padrao) + "</select></label></div>" +
    "<label class='campo'><span>Observação técnica</span><textarea id='e-obs' rows='2' maxlength='500' placeholder='Pontos de atenção na execução'>" + escapar(d.obs ?? "") + "</textarea></label>" +

    "<div id='e-erro' class='erro' hidden></div>" +
    "<div id='e-prog' hidden><div class='mini' id='e-status'>Salvando…</div><div class='barra-prog'><i id='e-barra'></i></div></div>" +
    "<div class='acoes'><button type='button' class='btn ghost' id='e-cancelar'>Cancelar</button>" +
    "<button type='submit' class='btn' id='e-salvar'>" + (ed ? "Salvar alterações" : "Criar exercício") + "</button></div></form>");

  const mostrarModo = (m) => {
    ex_.modo = m;
    $$("[data-vmodo]").forEach((b) => b.classList.toggle("on", b.dataset.vmodo === m));
    $$("[data-vpainel]").forEach((p) => (p.hidden = p.dataset.vpainel !== m));
    $("#e-erro").hidden = true;
  };
  $$("[data-vmodo]").forEach((b) => b.addEventListener("click", () => mostrarModo(b.dataset.vmodo)));
  mostrarModo(ex_.modo);

  $("#e-yt").addEventListener("input", (e) => {
    const id = idYoutube(e.target.value);
    $("#e-yt-prev").innerHTML = !e.target.value.trim() ? ""
      : id ? midiaVideo(urlYoutube(id), "vid-prev")
      : "<div class='mini aviso-yt'>Não reconheci esse link. Use o endereço do vídeo (youtube.com/watch?v=… , youtu.be/… ou youtube.com/shorts/…).</div>";
  });
  $("#e-arquivo").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    const prev = $("#e-arq-prev");
    if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
    prev.innerHTML = ""; delete prev.dataset.url;
    if (!f) return;
    $("#e-arq-nome").textContent = f.name + " · " + (f.size / 1048576).toFixed(1) + " MB";
    const problema = validarArquivoVideo(f);
    if (problema) { $("#e-erro").textContent = problema; $("#e-erro").hidden = false; return; }
    $("#e-erro").hidden = true;
    try {
      const u = URL.createObjectURL(f);
      prev.dataset.url = u;
      prev.innerHTML = "<video class='vid-prev' src='" + u + "' controls muted playsinline preload='metadata'></video>";
    } catch { /* prévia é opcional */ }
  });
  $("#e-cancelar").addEventListener("click", fecharModal);
  $("#form-ex").addEventListener("submit", salvarExercicio);
}

async function salvarExercicio(e) {
  e.preventDefault();
  const cErro = $("#e-erro");
  const falha = (m) => { cErro.innerHTML = m; cErro.hidden = false; };
  cErro.hidden = true;

  const nome = $("#e-nome").value.trim();
  if (!nome) { $("#e-nome").focus(); return falha("Dê um nome ao exercício."); }

  let urlNova = ex_.modo === "manter" ? ex_.antigo : null;
  let arquivo = null;
  if (ex_.modo === "youtube") {
    const bruto = $("#e-yt").value.trim();
    if (bruto) {
      const id = idYoutube(bruto);
      if (!id) return falha("Esse link não parece ser de um vídeo do YouTube.");
      urlNova = urlYoutube(id);
    }
  }
  if (ex_.modo === "arquivo") {
    arquivo = $("#e-arquivo").files?.[0];
    const problema = validarArquivoVideo(arquivo);
    if (problema) return falha(problema);
  }

  const btn = $("#e-salvar");
  btn.disabled = true;
  const prog = (p, txt) => { $("#e-prog").hidden = false; $("#e-barra").style.width = p + "%"; $("#e-status").textContent = txt; };
  prog(8, "Salvando…");

  // 1) sobe o arquivo antes de gravar, para não deixar exercício com vídeo quebrado
  let subido = null;
  if (arquivo) {
    subido = await subirVideo(arquivo, prog);
    if (!subido) { btn.disabled = false; $("#e-prog").hidden = true; return falha("O vídeo não subiu. Confira a conexão e tente de novo — ou use um link do YouTube."); }
    urlNova = subido.url;
  }

  const campos = {
    nome, grupo: $("#e-grupo").value, padrao: $("#e-padrao").value,
    obs: $("#e-obs").value.trim() || null, video_url: urlNova,
  };
  const r = await comTratamento(
    ex_.id
      ? sb.from("exercises").update(campos).eq("id", ex_.id).select().single()
      : sb.from("exercises").insert({ owner_id: estado.usuario.id, ...campos }).select().single(),
    ex_.id ? "Não consegui salvar o exercício" : "Não consegui criar o exercício");

  if (!r.ok || !r.data) {
    if (subido) await sb.storage.from("exercise-videos").remove([subido.caminho]); // não deixa arquivo órfão
    btn.disabled = false; $("#e-prog").hidden = true;
    return falha("Nada foi salvo. Tente de novo.");
  }
  // 2) relê e confere
  const conf = await sb.from("exercises").select("id,nome,video_url").eq("id", r.data.id).maybeSingle();
  if (!conf.data || conf.data.video_url !== urlNova) {
    btn.disabled = false; $("#e-prog").hidden = true;
    return falha("Salvei, mas a conferência não bateu. Recarregue a biblioteca para verificar.");
  }
  // 3) vídeo antigo que saiu do Storage não fica ocupando espaço
  if (ex_.antigo && ex_.antigo !== urlNova && ehDoStorage(ex_.antigo)) {
    const c = caminhoNoStorage(ex_.antigo);
    if (c) sb.storage.from("exercise-videos").remove([c]).catch(() => {});
  }

  prog(100, "Pronto");
  const aoCriar = ex_.aoCriar, editou = !!ex_.id;
  fecharModal();
  await carregarExercicios();
  desenharBiblioteca();
  carregarResumo();
  bom(r.data.nome + (editou ? " atualizado" : " criado") + (urlNova ? " com vídeo" : ""));
  if (aoCriar && !editou) aoCriar(r.data);
}

$("#btn-novo-ex").addEventListener("click", () => abrirExercicio());
$("#atalho-novo-ex").addEventListener("click", () => abrirExercicio());
$("#btn-criar-ex-lib").addEventListener("click", () =>
  abrirExercicio({ nome: $("#in-busca-lib").value.trim(), aoCriar: (ex) => adicionarExercicio(ex.id) }));

async function apagarExercicio(id) {
  const ex = estado.exercicios.find((e) => e.id === id);
  abrirModal(
    "<h3>Apagar exercício?</h3><p class='desc'>" + escapar(ex?.nome ?? "") +
    " sai da sua biblioteca. Treinos já prescritos não mudam.</p>" +
    "<div class='acoes'><button class='btn ghost' id='x-nao'>Cancelar</button>" +
    "<button class='btn perigo' id='x-sim'>Apagar</button></div>");
  $("#x-nao").addEventListener("click", fecharModal);
  $("#x-sim").addEventListener("click", async () => {
    const r = await comTratamento(sb.from("exercises").delete().eq("id", id), "Não consegui apagar");
    fecharModal();
    if (!r.ok) return;
    if (ehDoStorage(ex?.video_url)) {
      const c = caminhoNoStorage(ex.video_url);
      if (c) sb.storage.from("exercise-videos").remove([c]).catch(() => {});
    }
    await carregarExercicios();
    desenharBiblioteca();
    bom("Exercício apagado");
  });
}

estadoRede();
sb.auth.onAuthStateChange((evento) => {
  if (evento === "SIGNED_OUT") mostrarTela("login");
});
entrar().catch((e) => {
  console.error(e);
  mostrarTela("login");
  erro("Não consegui iniciar o app. Recarregue a página.");
});

/* =========================================================
   APP DO ALUNO
   Registro serie a serie no estilo Treino.io: o aluno preenche
   carga e reps de cada serie, marca como concluida, e cada serie
   e gravada na hora. Numero de carga interna nenhum aparece aqui.
   ========================================================= */
const al = {
  treinos: [],
  exercicios: {},
  treino: null,
  sessao: null,
  itens: [],
  ultimas: {},
  inicio: null,
  relogio: null,
  descanso: null,
  salvando: 0,
};

async function iniciarAluno() {
  const primeiro = estado.perfil.nome.split(" ")[0];
  $("#aluno-ola").textContent = "Olá, " + primeiro;
  $("#aluno-av").textContent = iniciais(estado.perfil.nome);
  $("#aluno-data").textContent = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
  });
  await carregarBibliotecaAluno();
  await carregarCheckinHoje();
  await carregarTreinosAluno();
  carregarAgua();
}

function telaAluno(qual) {
  $$(".tela-aluno").forEach((s) => s.classList.toggle("on", s.dataset.tela === qual));
  $$("[data-tela-nav]").forEach((b) => b.classList.toggle("on", b.dataset.telaNav === qual));
  $("#aluno-nav").hidden = qual === "executar";
  $("#aluno-corpo").scrollTo(0, 0);
  window.scrollTo(0, 0);
  if (qual === "historico") carregarHistoricoAluno();
  if (qual === "checkin") desenharCheckin();
  if (qual === "extra") { desenharExtraForm(); carregarExtrasAluno(); }
  if (qual === "agua") desenharAgua();
  if (qual === "calendario") abrirCalendario();
  if (qual === "progresso") abrirProgresso();
}
$$("[data-tela-nav]").forEach((b) =>
  b.addEventListener("click", () => telaAluno(b.dataset.telaNav)));

async function carregarBibliotecaAluno() {
  const r = await comTratamento(
    sb.from("exercises").select("id,nome,grupo,padrao,categoria,video_url,obs"),
    "Não consegui carregar os exercícios");
  if (!r.ok) return;
  al.exercicios = {};
  (r.data ?? []).forEach((e) => (al.exercicios[e.id] = e));
}

async function carregarTreinosAluno() {
  const r = await comTratamento(
    sb.from("workouts").select("id,nome,data,estrutura,status,semanas,sessoes_por_semana")
      .eq("status", "publicado").order("data", { ascending: false }).limit(10),
    "Não consegui carregar seus treinos");
  if (!r.ok) return;
  al.treinos = (r.data ?? []).filter((t) => Array.isArray(t.estrutura) && t.estrutura.length);

  // semana atual de cada treino: avança a cada N sessões concluídas
  const feitas = await sb.from("session_logs").select("workout_id")
    .eq("aluno_id", estado.usuario.id).eq("finalizada", true);
  const cont = {};
  (feitas.data ?? []).forEach((s) => (cont[s.workout_id] = (cont[s.workout_id] ?? 0) + 1));
  al.treinos.forEach((t) => {
    const total = t.semanas || 1, freq = t.sessoes_por_semana || 1;
    const n = cont[t.id] ?? 0;
    t.semanaAtual = Math.min(total, Math.floor(n / freq) + 1);
    t.cicloFeito = total > 1 && n >= total * freq;
    t.feitasNaSemana = n - (t.semanaAtual - 1) * freq;
  });
  desenharTreinosHoje();
}

function desenharTreinosHoje() {
  desenharAtalhosAluno();
  const alvo = $("#lista-treinos");
  if (!al.treinos.length) {
    alvo.innerHTML = "<div class='vazio-hoje'><b>Nenhum treino por aqui ainda</b>" +
      "Assim que seu treinador publicar, ele aparece nesta tela.</div>";
    return;
  }
  const hoje = hojeISO();
  const cards = al.treinos.map((t) => {
    const w = t.semanaAtual || 1;
    const series = t.estrutura.reduce((s, e) => s + seriesDaSemana(e, w).length, 0);
    const min = Math.round(t.estrutura.reduce(
      (s, e) => s + seriesDaSemana(e, w).length * ((parseInt(e.descanso_s) || 0) + 45), 0) / 60);
    const previa = t.estrutura.slice(0, 3)
      .map((e) => "<span>" + escapar(e.nome) + " <em>" + esquemaTexto(e, w) + "</em></span>").join("");
    const resto = t.estrutura.length > 3
      ? "<span class='resto'>+ " + (t.estrutura.length - 3) + " exercício" + (t.estrutura.length - 3 > 1 ? "s" : "") + "</span>" : "";
    const faixaSemana = (t.semanas || 1) > 1
      ? "<div class='semana-faixa'><b>Semana " + w + " de " + t.semanas + "</b><span>" +
        (t.cicloFeito ? "ciclo concluído — fale com seu treinador"
          : t.feitasNaSemana + " de " + (t.sessoes_por_semana || 1) + " treinos feitos nesta semana") +
        "</span><i style='--p:" + (t.cicloFeito ? 100 : Math.round(100 * t.feitasNaSemana / (t.sessoes_por_semana || 1))) + "%'></i></div>" : "";
    const tag = t.data === hoje ? "Hoje"
      : "Desde " + new Date(t.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return "<article class='treino-card'>" +
      "<div class='hero-txt'><span class='tag'>" + tag + "</span>" +
      "<h2>" + escapar(t.nome) + "</h2>" + faixaSemana +
      "<div class='lista-previa'>" + previa + resto + "</div>" +
      "<button class='btn' data-comecar='" + t.id + "'>Começar treino <span class='chev'>›</span></button></div>" +
      "<div class='hero-arte' aria-hidden='true'>" + MARCA_ARTE +
      "<div class='resumo'><div><b>" + min + "</b>min</div><div><b>" + series + "</b>séries</div>" +
      "<div><b>" + t.estrutura.length + "</b>exercícios</div></div></div></article>";
  });
  alvo.innerHTML = "<div class='carrossel' id='carrossel'>" + cards.join("") + "</div>" +
    (cards.length > 1 ? "<div class='pontos' id='pontos'>" + cards.map((_, k) => "<i" + (k ? "" : " class='on'") + "></i>").join("") + "</div>" : "");
  $$("[data-comecar]").forEach((b) =>
    b.addEventListener("click", () => comecarTreino(b.dataset.comecar)));
  const car = $("#carrossel"), pts = $$("#pontos i");
  if (pts.length) car.addEventListener("scroll", () => {
    const k = Math.round(car.scrollLeft / (car.firstElementChild.offsetWidth + 12));
    pts.forEach((p, n) => p.classList.toggle("on", n === k));
  }, { passive: true });
}

const MARCA_ARTE = "<svg class='arte-marca' viewBox='0 0 24 24' fill='none'>" +
  "<path d='M12 2L21 6.5L12 11L3 6.5L12 2Z' fill='rgba(255,255,255,.22)'/>" +
  "<path d='M3 11L12 15.5L21 11' stroke='rgba(255,255,255,.3)' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/>" +
  "<path d='M3 15.5L12 20L21 15.5' stroke='rgba(255,255,255,.22)' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>";

const ICONE = {
  executar: "<path d='M10 2h4M12 14l3-3'/><circle cx='12' cy='14' r='8'/>",
  checkin: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
  historico: "<path d='M4 19V5M4 19h16M8 17V9M12 17V6M16 17v-5'/>",
  extra: "<circle cx='13' cy='4' r='2'/><path d='M7 21l3-6 3 2v4M10 15l1-5 4 3 3 1M8 11l3-1'/>",
  agua: "<path d='M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z'/>",
  calendario: "<rect x='3' y='4' width='18' height='17' rx='2'/><path d='M3 9h18M8 2v4M16 2v4'/>",
  progresso: "<path d='M3 17l5-5 4 3 7-7'/><path d='M14 8h5v5'/>",
};
const svgIcone = (k) => "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + ICONE[k] + "</svg>";

function desenharAtalhosAluno() {
  const alvo = $("#atalhos-aluno");
  if (!alvo) return;
  const tem = al.treinos.length > 0;
  alvo.innerHTML =
    "<button class='atalho' data-atalho='executar'" + (tem ? "" : " disabled") + ">" + svgIcone("executar") +
      "<b>Executar treino</b></button>" +
    bannerCheckin() +
    "<button class='atalho' data-atalho='agua'>" + svgIcone("agua") +
      (ag.meta ? "<span class='selo" + (ag.ml >= ag.meta ? " verde" : "") + "'>" + fmtNum(ag.ml / 1000) + " / " + fmtNum(ag.meta / 1000) + " L</span>" : "") +
      "<b>Hidratação</b></button>" +
    "<button class='atalho' data-atalho='extra'>" + svgIcone("extra") + "<b>Treino extra</b><small>Corrida, yoga, pelada…</small></button>" +
    "<button class='atalho' data-atalho='progresso'>" + svgIcone("progresso") + "<b>Minha progressão</b><small>Evolução das cargas</small></button>" +
    "<button class='atalho' data-atalho='calendario'>" + svgIcone("calendario") + "<b>Meu calendário</b></button>" +
    "<button class='atalho' data-atalho='historico'>" + svgIcone("historico") + "<b>Meu histórico</b></button>";
  $$("[data-atalho='executar']").forEach((b) => b.addEventListener("click", () => {
    if (!al.treinos.length) return;
    comecarTreino((al.treinos.find((t) => t.data === hojeISO()) ?? al.treinos[0]).id);
  }));
  ["historico", "agua", "extra", "calendario", "progresso"].forEach((t) =>
    $$("[data-atalho='" + t + "']").forEach((b) => b.addEventListener("click", () => telaAluno(t))));
  ligarBannerCheckin();
}

/* ---------- ondulação: o que vale nesta semana ---------- */
function ondaParaSerie(o) {
  return { carga_alvo: o.carga ?? "", reps_alvo: o.reps ?? "", tempo_alvo: o.tempo ?? "", dist_alvo: o.dist ?? "" };
}
function seriesDaSemana(ex, w) {
  if (Array.isArray(ex.ondas) && ex.ondas.length) {
    const o = ex.ondas[Math.min(w, ex.ondas.length) - 1];
    return Array.from({ length: parseInt(o.series) || 1 }, () => ondaParaSerie(o));
  }
  return ex.series ?? [];
}
function esquemaTexto(ex, w) {
  const s = seriesDaSemana(ex, w);
  const c = camposDe(ex), p = s[0] ?? {};
  const vol = c.includes("reps") ? (p.reps_alvo || "")
    : c.includes("tempo") ? fmtTempo(p.tempo_alvo)
    : c.includes("dist") ? (p.dist_alvo ? p.dist_alvo + " m" : "") : "";
  return s.length + "×" + vol;
}

/* ---------- abrir a sessão ---------- */
async function comecarTreino(workoutId) {
  const treino = al.treinos.find((t) => t.id === workoutId);
  if (!treino) return;

  const btn = document.querySelector("[data-comecar='" + workoutId + "']");
  if (btn) { btn.disabled = true; btn.textContent = "Abrindo…"; }

  // retoma uma sessão não terminada em vez de criar outra
  const aberta = await comTratamento(
    sb.from("session_logs").select("id,criado_em")
      .eq("workout_id", workoutId).eq("aluno_id", estado.usuario.id)
      .eq("finalizada", false).order("criado_em", { ascending: false }).limit(1),
    "Não consegui abrir o treino");
  if (!aberta.ok) { if (btn) { btn.disabled = false; btn.textContent = "Começar treino"; } return; }

  let sessao = aberta.data?.[0] ?? null;
  let feitas = [];

  if (sessao) {
    const s = await comTratamento(
      sb.from("workout_sets").select("exercise_id,serie_num,carga_kg,reps,tempo_s,dist_m,concluida")
        .eq("session_id", sessao.id),
      "Não consegui recuperar o que você já tinha feito");
    feitas = s.ok ? (s.data ?? []) : [];
  } else {
    const nova = await comTratamento(
      sb.from("session_logs").insert({ workout_id: workoutId, aluno_id: estado.usuario.id, semana: treino.semanaAtual || 1 })
        .select().single(),
      "Não consegui iniciar a sessão");
    if (!nova.ok) { if (btn) { btn.disabled = false; btn.textContent = "Começar treino"; } return; }
    sessao = nova.data;
  }

  al.treino = treino;
  al.sessao = sessao;
  al.inicio = new Date(sessao.criado_em ?? Date.now());
  al.itens = treino.estrutura.map((ex) => ({
    exercise_id: ex.exercise_id,
    nome: ex.nome,
    metodo: ex.metodo,
    registro: registroDe(ex),
    descanso_s: parseInt(ex.descanso_s) || 90,
    series: seriesDaSemana(ex, treino.semanaAtual || 1).map((s, j) => {
      const feita = feitas.find((f) => f.exercise_id === ex.exercise_id && f.serie_num === j + 1);
      return {
        carga: feita ? (feita.carga_kg ?? "") : "",
        reps: feita ? (feita.reps ?? "") : "",
        tempo: feita && feita.tempo_s != null ? fmtTempo(feita.tempo_s) : "",
        dist: feita ? (feita.dist_m ?? "") : "",
        alvo_carga: s.carga_alvo ?? "",
        alvo_reps: s.reps_alvo ?? "",
        alvo_tempo: s.tempo_alvo ? fmtTempo(s.tempo_alvo) : "",
        alvo_dist: s.dist_alvo ?? "",
        concluida: feita ? !!feita.concluida : false,
      };
    }),
  }));

  if (btn) { btn.disabled = false; btn.textContent = "Começar treino"; }

  await carregarUltimasCargas();
  $("#exec-nome").textContent = treino.nome;
  telaAluno("executar");
  desenharExecucao(0);
  iniciarRelogio();
}

/* ---------- o "última vez" de cada exercício ---------- */
async function carregarUltimasCargas() {
  al.ultimas = {};
  const ids = al.itens.map((i) => i.exercise_id);
  if (!ids.length) return;
  const r = await sb.from("workout_sets")
    .select("exercise_id,serie_num,carga_kg,reps,tempo_s,dist_m,criado_em,session_id")
    .in("exercise_id", ids).eq("concluida", true)
    .neq("session_id", al.sessao.id)
    .order("criado_em", { ascending: false }).limit(300);
  if (r.error) return;
  (r.data ?? []).forEach((s) => {
    const atual = al.ultimas[s.exercise_id];
    if (!atual || s.criado_em > atual.criado_em) {
      al.ultimas[s.exercise_id] = s;
    }
  });
}

/* ---------- a tela de execução ---------- */
function desenharExecucao(abrirIndice) {
  const feitasTotais = al.itens.reduce(
    (n, it) => n + it.series.filter((s) => s.concluida).length, 0);
  const totais = al.itens.reduce((n, it) => n + it.series.length, 0);
  const sem = (al.treino?.semanas || 1) > 1 ? "Semana " + (al.treino.semanaAtual || 1) + " · " : "";
  $("#exec-prog").textContent = sem + feitasTotais + " de " + totais + " séries";

  $("#exec-lista").innerHTML = al.itens.map((it, i) => {
    const ex = al.exercicios[it.exercise_id] ?? {};
    const campos = REGISTROS[it.registro].campos;
    const grade = "style='grid-template-columns:30px repeat(" + campos.length + ",1fr) 46px'";
    const pronto = it.series.every((s) => s.concluida);
    const aberto = i === abrirIndice;
    const ult = al.ultimas[it.exercise_id];

    const midia = ex.video_url
      ? midiaVideo(ex.video_url, "video-ex")
      : "<div class='sem-video-ex'>sem vídeo demonstrativo</div>";

    const obs = ex.obs ? "<div class='obs-ex'>" + escapar(ex.obs) + "</div>" : "";

    const ultima = ult
      ? "<div class='ultima-vez'>Última vez: <b>" + descreverSerie(ult) + "</b></div>"
      : "<div class='ultima-vez'>Primeira vez fazendo este exercício</div>";

    const cab = "<div class='cab-series' " + grade + "><span>#</span>" +
      campos.map((k) => "<span>" + CAMPOS[k].curto + "</span>").join("") + "<span>ok</span></div>";

    const linhas = it.series.map((s, j) =>
      "<div class='serie-linha " + (s.concluida ? "feita" : "") + "' " + grade + ">" +
      "<div class='n'>" + (j + 1) + "</div>" +
      campos.map((k) => {
        const inp = "<input inputmode='" + CAMPOS[k].modo + "' value='" + escapar(s[k]) + "' placeholder='" +
          escapar(s["alvo_" + k] || "—") + "' data-serie='" + i + ":" + j + ":" + k + "'>";
        return k !== "tempo" ? inp : "<div class='cel-tempo'>" + inp +
          "<button class='play' data-cronometrar='" + i + ":" + j + "' title='Cronometrar esta série' aria-label='Cronometrar'>" +
          "<svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z' fill='currentColor'/></svg></button></div>";
      }).join("") +
      "<button class='ok' data-ok='" + i + ":" + j + "' title='Concluir série'>" + (s.concluida ? "✓" : "○") + "</button>" +
      "</div>").join("");

    return "<div class='ex-card " + (aberto ? "aberto " : "") + (pronto ? "pronto" : "") + "' data-card='" + i + "'>" +
      "<div class='ex-cab' data-abrir='" + i + "'>" +
      "<div class='ordem'>" + (pronto ? "✓" : i + 1) + "</div>" +
      "<div class='txt'><b>" + escapar(it.nome) + "</b><span>" +
      it.series.filter((s) => s.concluida).length + " de " + it.series.length + " séries" +
      (it.metodo && it.metodo !== "normal" ? " · " + escapar(it.metodo) : "") + "</span></div>" +
      "<div class='seta'>›</div></div>" +
      "<div class='ex-corpo'>" + midia + obs + ultima + cab + linhas +
      "<div class='rodape-ex'><span class='ultima-vez'>Descanso: <b>" + fmtTempo(it.descanso_s) + "</b></span>" +
      "<button class='btn ghost sm' data-descansar='" + i + "'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='12' cy='13' r='8'/><path d='M12 9v4l2 2M10 2h4'/></svg>Descansar agora</button></div>" +
      "</div></div>";
  }).join("");

  protegerVideos($("#exec-lista"));
  $$("[data-abrir]").forEach((el) =>
    el.addEventListener("click", () => {
      const card = el.parentElement;
      const jaAberto = card.classList.contains("aberto");
      $$(".ex-card").forEach((c) => c.classList.remove("aberto"));
      if (!jaAberto) card.classList.add("aberto");
    }));

  $$("[data-serie]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const [i, j, campo] = inp.dataset.serie.split(":");
      al.itens[+i].series[+j][campo] = inp.value;
    });
    inp.addEventListener("blur", () => {
      const [i, j] = inp.dataset.serie.split(":").map(Number);
      if (al.itens[i].series[j].concluida) gravarSerie(i, j);
    });
  });

  $$("[data-ok]").forEach((b) =>
    b.addEventListener("click", () => alternarSerie(...b.dataset.ok.split(":").map(Number))));
  $$("[data-cronometrar]").forEach((b) =>
    b.addEventListener("click", () => cronometrarSerie(...b.dataset.cronometrar.split(":").map(Number))));
  $$("[data-descansar]").forEach((b) =>
    b.addEventListener("click", () => comecarDescanso(al.itens[+b.dataset.descansar].descanso_s, proximoTexto(+b.dataset.descansar))));
}

/* ---------- gravar série a série ---------- */
async function alternarSerie(i, j) {
  const s = al.itens[i].series[j];
  const virandoFeita = !s.concluida;

  if (virandoFeita && REGISTROS[al.itens[i].registro].campos.every((k) => !String(s[k] ?? "").trim())) {
    // sem nada preenchido, assume o alvo prescrito
    s.carga = s.alvo_carga;
    s.reps = s.alvo_reps;
    s.tempo = s.alvo_tempo;
    s.dist = s.alvo_dist;
  }
  s.concluida = virandoFeita;

  const ok = await gravarSerie(i, j);
  if (!ok) { s.concluida = !virandoFeita; }

  const aberto = [...document.querySelectorAll(".ex-card")].findIndex((c) => c.classList.contains("aberto"));
  desenharExecucao(aberto);

  if (ok && virandoFeita) {
    const todas = al.itens[i].series.every((x) => x.concluida);
    if (!todas) comecarDescanso(al.itens[i].descanso_s, proximoTexto(i));
  }
}

async function gravarSerie(i, j) {
  const it = al.itens[i];
  const s = it.series[j];
  const num = (v) => {
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };
  const usa = REGISTROS[it.registro].campos;
  const seg = usa.includes("tempo") ? segundos(s.tempo) : null;
  if (usa.includes("tempo") && String(s.tempo ?? "").trim() && seg == null) {
    erro("Tempo não reconhecido — use segundos (45) ou minutos:segundos (1:30)");
    return false;
  }
  const r = await comTratamento(
    sb.from("workout_sets").upsert({
      session_id: al.sessao.id,
      exercise_id: it.exercise_id,
      serie_num: j + 1,
      carga_kg: usa.includes("carga") ? num(s.carga) : null,
      reps: usa.includes("reps") && s.reps !== "" ? parseInt(s.reps) || null : null,
      tempo_s: seg,
      dist_m: usa.includes("dist") ? num(s.dist) : null,
      concluida: s.concluida,
    }, { onConflict: "session_id,exercise_id,serie_num" }).select().single(),
    "Não consegui salvar a série");
  return r.ok;
}

/* ---------- relógio da sessão ---------- */
function iniciarRelogio() {
  clearInterval(al.relogio);
  const passo = () => {
    const seg = Math.max(0, Math.floor((Date.now() - al.inicio.getTime()) / 1000));
    const m = String(Math.floor(seg / 60)).padStart(2, "0");
    const s = String(seg % 60).padStart(2, "0");
    $("#cronometro").textContent = m + ":" + s;
  };
  passo();
  al.relogio = setInterval(passo, 1000);
}

/* =========================================================
   CRONÔMETRO — descanso e séries por tempo
   Conta pelo relógio do aparelho (Date.now), não por "ticks":
   se a tela apagar ou o app for para o fundo, ao voltar o tempo está certo.
   ========================================================= */
const tm = { aberto: false, modo: null, fase: null, fim: 0, inicio: 0, pausa: 0, alvo: 0, seg: 0, tick: null, ctx: null, lock: null, bipou: {}, aoTerminar: null, mini: false };
const ANEL = 2 * Math.PI * 88;

function audioTimer() {
  try {
    tm.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (tm.ctx.state === "suspended") tm.ctx.resume();
  } catch { tm.ctx = null; }
  return tm.ctx;
}
function bip(freq = 880, dur = 0.12, vezes = 1) {
  const c = audioTimer();
  if (!c) return;
  for (let k = 0; k < vezes; k++) {
    const t0 = c.currentTime + k * 0.22;
    const o = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }
}
const vibrar = (p) => { try { navigator.vibrate?.(p); } catch { /* iPhone não vibra pelo navegador */ } };
async function telaLigada(sim) {
  try {
    if (sim && "wakeLock" in navigator && !tm.lock) tm.lock = await navigator.wakeLock.request("screen");
    if (!sim && tm.lock) { await tm.lock.release(); tm.lock = null; }
  } catch { tm.lock = null; }
}
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};

/*
  abrirTimer({ modo: "descanso", seg, sub })
  abrirTimer({ modo: "serie", seg (0 = cronômetro progressivo), titulo, sub, aoTerminar(segundosFeitos) })
*/
function abrirTimer(op) {
  clearInterval(tm.tick);
  audioTimer(); // o toque do aluno libera o som no celular
  Object.assign(tm, { aberto: true, modo: op.modo, aoTerminar: op.aoTerminar ?? null, alvo: (parseInt(op.seg) || 0) * 1000,
    pausa: 0, bipou: {}, mini: false });
  $("#timer-rot").textContent = op.modo === "descanso" ? "Descanso" : op.titulo ?? "Série";
  $("#timer-sub").textContent = op.sub ?? "";
  $("#timer").dataset.modo = op.modo;
  if (op.modo === "descanso") iniciarFase("contagem", tm.alvo || 90000);
  else iniciarFase("preparo", 3000);
  $("#timer").hidden = false;
  $("#timer").classList.remove("mini");
  telaLigada(true);
  tm.tick = setInterval(passoTimer, 200);
  passoTimer();
}
function iniciarFase(fase, dur) {
  tm.fase = fase;
  tm.inicio = Date.now();
  tm.seg = dur;
  tm.fim = dur ? tm.inicio + dur : 0;
  tm.bipou = {};
  $("#timer").dataset.fase = fase;
  $("#timer-pausar").textContent = "Pausar";
  const rotFim = { contagem: "Pular", preparo: "Cancelar", trabalho: "Terminar série", livre: "Parar e registrar" };
  $("#timer-fim").textContent = rotFim[fase];
  $("#timer-fase").textContent = { contagem: "", preparo: "Prepare-se", trabalho: tm.alvo ? "Segure!" : "Valendo", livre: "Valendo" }[fase];
}
function restanteMs() {
  const agora = tm.pausa || Date.now();
  return tm.fim ? tm.fim - agora : agora - tm.inicio;   // na fase livre, devolve o tempo decorrido
}
function passoTimer() {
  if (!tm.aberto) return;
  const r = restanteMs();
  const contaPraBaixo = tm.fase !== "livre";
  $("#timer-num").textContent = contaPraBaixo ? (tm.fase === "preparo" ? String(Math.max(1, Math.ceil(r / 1000))) : mmss(r)) : mmss(r);
  $("#timer-mini-num").textContent = $("#timer-num").textContent;
  const frac = contaPraBaixo ? Math.max(0, Math.min(1, r / tm.seg)) : (r % 60000) / 60000;
  $("#timer-arco").style.strokeDashoffset = String(ANEL * (1 - frac));
  if (tm.pausa) return;

  // bipes curtos nos 3 últimos segundos, longo no zero
  if (contaPraBaixo) {
    const s = Math.ceil(r / 1000);
    if (s <= 3 && s >= 1 && !tm.bipou[s]) { tm.bipou[s] = 1; bip(660, 0.09); vibrar(60); }
    if (r <= 0) terminarFase();
  }
}
function terminarFase() {
  if (tm.fase === "preparo") {
    bip(990, 0.25); vibrar(200);
    iniciarFase(tm.alvo ? "trabalho" : "livre", tm.alvo);
    return passoTimer();
  }
  if (tm.fase === "trabalho") {
    bip(990, 0.3, 2); vibrar([200, 100, 200]);
    return concluirSerieTimer(Math.round(tm.alvo / 1000));
  }
  if (tm.fase === "contagem") {
    bip(990, 0.3, 2); vibrar([200, 100, 200]);
    $("#timer-num").textContent = "Bora!";
    $("#timer-mini-num").textContent = "Bora!";
    clearInterval(tm.tick);
    setTimeout(() => { if (tm.fase === "contagem" && tm.aberto) fecharTimer(); }, 1500);
  }
}
async function concluirSerieTimer(seg) {
  const cb = tm.aoTerminar;
  fecharTimer();
  if (cb && seg > 0) await cb(seg);
}
function fecharTimer() {
  clearInterval(tm.tick);
  tm.aberto = false;
  $("#timer").hidden = true;
  telaLigada(false);
}

$("#timer-pausar").addEventListener("click", () => {
  if (!tm.aberto) return;
  if (tm.pausa) {                               // continuar: empurra o fim pelo tempo parado
    const parado = Date.now() - tm.pausa;
    tm.inicio += parado; if (tm.fim) tm.fim += parado;
    tm.pausa = 0;
    $("#timer-pausar").textContent = "Pausar";
    $("#timer").classList.remove("pausado");
  } else {
    tm.pausa = Date.now();
    $("#timer-pausar").textContent = "Continuar";
    $("#timer").classList.add("pausado");
  }
  passoTimer();
});
$("#timer-fim").addEventListener("click", () => {
  if (tm.fase === "contagem" || tm.fase === "preparo") return fecharTimer();
  // terminar antes / parar o progressivo: registra o tempo realmente feito
  const feito = tm.fase === "livre" ? restanteMs() : (tm.alvo - Math.max(0, restanteMs()));
  concluirSerieTimer(Math.round(feito / 1000));
});
$("#timer-fechar").addEventListener("click", fecharTimer);
$$("[data-tajuste]").forEach((b) => b.addEventListener("click", () => {
  const d = parseInt(b.dataset.tajuste) * 1000;
  tm.fim = Math.max((tm.pausa || Date.now()) + 1000, tm.fim + d);
  tm.seg = Math.max(tm.seg + d, tm.fim - (tm.pausa || Date.now()));
  tm.bipou = {};
  passoTimer();
}));
$("#timer-minimizar").addEventListener("click", () => { $("#timer").classList.add("mini"); });
$("#timer-mini").addEventListener("click", (e) => {
  if (e.target.closest("#timer-mini-pular")) return fecharTimer();
  $("#timer").classList.remove("mini");
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && tm.aberto) {
    if (tm.lock === null) telaLigada(true);   // o sistema solta a trava quando a aba sai de foco
    passoTimer();
  }
});

function comecarDescanso(segundos, sub) {
  abrirTimer({ modo: "descanso", seg: parseInt(segundos) || 90, sub: sub ?? "" });
}
/* texto "Próximo: Supino — série 2 de 3" */
function proximoTexto(i) {
  const it = al.itens[i];
  const j = it.series.findIndex((s) => !s.concluida);
  if (j >= 0) return "Próximo: " + it.nome + " — série " + (j + 1) + " de " + it.series.length;
  const k = al.itens.findIndex((x, n) => n > i && x.series.some((s) => !s.concluida));
  return k >= 0 ? "Próximo: " + al.itens[k].nome : "";
}

/* cronometrar uma série por tempo */
function cronometrarSerie(i, j) {
  const it = al.itens[i], s = it.series[j];
  const alvo = segundos(s.alvo_tempo) ?? segundos(s.tempo) ?? 0;
  const carga = String(s.carga || s.alvo_carga || "").trim();
  abrirTimer({
    modo: "serie", seg: alvo, titulo: it.nome,
    sub: "Série " + (j + 1) + " de " + it.series.length + (carga && REGISTROS[it.registro].campos.includes("carga") ? " · " + carga + " kg" : "") +
      (alvo ? "" : " · cronômetro livre"),
    aoTerminar: async (feitos) => {
      s.tempo = fmtTempo(feitos);
      if (!String(s.carga ?? "").trim()) s.carga = s.alvo_carga;
      if (!String(s.dist ?? "").trim()) s.dist = s.alvo_dist;
      const antes = s.concluida;
      s.concluida = true;
      const ok = await gravarSerie(i, j);
      if (!ok) s.concluida = antes;
      desenharExecucao(i);
      if (ok) {
        const resta = al.itens.some((x) => x.series.some((y) => !y.concluida));
        if (resta) comecarDescanso(it.descanso_s, "✓ " + s.tempo + " registrados · " + proximoTexto(i));
        else bom("Série registrada: " + s.tempo);
      }
    },
  });
}

$("#btn-voltar").addEventListener("click", () => {
  clearInterval(al.relogio);
  fecharTimer();
  telaAluno("hoje");
});

/* ---------- terminar: PSE ---------- */
$("#btn-terminar").addEventListener("click", () => {
  const feitas = al.itens.reduce((n, it) => n + it.series.filter((s) => s.concluida).length, 0);
  if (!feitas) return erro("Marque ao menos uma série antes de terminar");
  perguntarPSE();
});

function perguntarPSE() {
  const minutos = Math.max(1, Math.round((Date.now() - al.inicio.getTime()) / 60000));
  abrirModal(
    "<h3>Como foi o treino?</h3>" +
    "<p class='desc'>Escolha o quanto ele exigiu de você, de 1 a 10.</p>" +
    "<div class='pse-legenda'><span>muito leve</span><span>máximo</span></div>" +
    "<div class='pse-grade' id='pse-grade'>" +
    [1,2,3,4,5,6,7,8,9,10].map((n) => "<button data-pse='" + n + "'>" + n + "</button>").join("") +
    "</div>" +
    "<label class='campo' style='margin-top:14px'><span>Duração (minutos)</span>" +
    "<input id='pse-min' type='number' inputmode='numeric' min='1' max='400' value='" + minutos + "'></label>" +
    "<div id='pse-erro' class='erro' hidden></div>" +
    "<div class='acoes'><button class='btn ghost' id='pse-voltar'>Voltar</button>" +
    "<button class='btn' id='pse-salvar'>Finalizar treino</button></div>");

  let escolhido = null;
  $$("[data-pse]").forEach((b) =>
    b.addEventListener("click", () => {
      escolhido = +b.dataset.pse;
      $$("[data-pse]").forEach((x) => x.classList.toggle("on", x === b));
    }));
  $("#pse-voltar").addEventListener("click", fecharModal);
  $("#pse-salvar").addEventListener("click", async () => {
    if (!escolhido) {
      const e = $("#pse-erro");
      e.textContent = "Escolha um número de 1 a 10.";
      e.hidden = false;
      return;
    }
    await finalizarTreino(escolhido, parseInt($("#pse-min").value) || minutos);
  });
}

async function finalizarTreino(pse, minutos) {
  const btn = $("#pse-salvar");
  btn.disabled = true;
  btn.textContent = "Salvando…";

  const r = await comTratamento(
    sb.from("session_logs").update({ pse, duracao_min: minutos, finalizada: true })
      .eq("id", al.sessao.id).select().single(),
    "Não consegui finalizar o treino");

  if (!r.ok) { btn.disabled = false; btn.textContent = "Finalizar treino"; return; }

  // relê do banco antes de dizer que deu certo
  const conf = await comTratamento(
    sb.from("session_logs").select("finalizada,pse").eq("id", al.sessao.id).single(),
    "Salvei, mas não consegui confirmar");
  if (!conf.ok || !conf.data.finalizada) { btn.disabled = false; btn.textContent = "Finalizar treino"; return; }

  clearInterval(al.relogio);
  fecharTimer();
  fecharModal();
  al.sessao = null;
  telaAluno("hoje");
  bom("Treino concluído. Bom trabalho!");
  await carregarTreinosAluno();
}

/* ---------- histórico do aluno ---------- */
async function carregarHistoricoAluno() {
  const alvo = $("#lista-historico");
  const r = await comTratamento(
    sb.from("session_logs").select("id,data,pse,duracao_min,finalizada,workout_id")
      .eq("finalizada", true).order("data", { ascending: false }).limit(30),
    "Não consegui carregar seu histórico");
  if (!r.ok) return;

  const sessoes = r.data ?? [];
  if (!sessoes.length) {
    alvo.innerHTML = "<div class='vazio-hoje'><b>Nada por aqui ainda</b>Seus treinos concluídos aparecem nesta lista.</div>";
    return;
  }

  const ids = sessoes.map((s) => s.id);
  const st = await sb.from("workout_sets").select("session_id,carga_kg,reps,concluida").in("session_id", ids);
  const porSessao = {};
  if (!st.error) {
    (st.data ?? []).filter((s) => s.concluida).forEach((s) => {
      const p = porSessao[s.session_id] ?? (porSessao[s.session_id] = { n: 0, vol: 0 });
      p.n++;
      p.vol += (Number(s.carga_kg) || 0) * (Number(s.reps) || 0);
    });
  }

  const nomes = {};
  al.treinos.forEach((t) => (nomes[t.id] = t.nome));

  alvo.innerHTML = sessoes.map((s) => {
    const p = porSessao[s.id] ?? { n: 0, vol: 0 };
    return "<div class='hist-item'><div class='linha1'><b>" +
      escapar(nomes[s.workout_id] ?? "Treino") + "</b><span class='pill'>" +
      new Date(s.data + "T12:00:00").toLocaleDateString("pt-BR") + "</span></div>" +
      "<div class='dados'>" + p.n + " séries · " +
      (p.vol ? Math.round(p.vol).toLocaleString("pt-BR") + " kg levantados · " : "") +
      (s.duracao_min ? s.duracao_min + " min · " : "") +
      "esforço " + rotuloPSE(s.pse) + "</div></div>";
  }).join("");
}

// o aluno ve rotulo, nunca formula nem unidade arbitraria
function rotuloPSE(pse) {
  if (!pse) return "—";
  if (pse <= 3) return "leve";
  if (pse <= 6) return "moderado";
  if (pse <= 8) return "puxado";
  return "máximo";
}

/* =========================================================
   GRÁFICOS (SVG puro, sem biblioteca)
   Uma série, um eixo, barras finas com ponta arredondada,
   dica ao passar o dedo/mouse. Cor = azul da marca.
   ========================================================= */
const COR_SERIE = "#2f97ef";
const fmt = (n, casas = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "—"
  : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

function ticksLimpos(max) {
  if (!max || max <= 0) return [0, 1];
  const bruto = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto);
  const t = [];
  for (let v = 0; v <= max + passo * 0.001; v += passo) t.push(v);
  if (t[t.length - 1] < max) t.push(t[t.length - 1] + passo);
  return t;
}

function mostrarDica(ev, html) {
  const d = $("#dica-graf");
  d.innerHTML = html;
  d.hidden = false;
  const x = (ev.touches?.[0]?.clientX ?? ev.clientX) + 12;
  const y = (ev.touches?.[0]?.clientY ?? ev.clientY) - 10;
  d.style.left = Math.min(x, window.innerWidth - d.offsetWidth - 8) + "px";
  d.style.top = Math.max(8, y - d.offsetHeight) + "px";
}
const esconderDica = () => ($("#dica-graf").hidden = true);

function moldura(el, pontos, altura) {
  const W = Math.max(el.clientWidth || 640, 280), H = altura;
  const m = { t: 14, r: 12, b: 26, l: 44 };
  const max = Math.max(...pontos.map((p) => p.valor ?? 0), 0);
  const ticks = ticksLimpos(max);
  const topo = ticks[ticks.length - 1] || 1;
  const y = (v) => m.t + (H - m.t - m.b) * (1 - v / topo);
  let grade = "";
  ticks.forEach((t) => {
    grade += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" class="g-grade"/>` +
      `<text x="${m.l - 8}" y="${y(t) + 4}" class="g-eixo" text-anchor="end">${fmt(t)}</text>`;
  });
  return { W, H, m, y, grade };
}

function graficoBarras(el, pontos, { unidade = "", rotuloCada = 1 } = {}) {
  if (!pontos.length || pontos.every((p) => !p.valor)) {
    el.innerHTML = "<div class='g-vazio'>Ainda não há carga registrada neste período.</div>";
    return;
  }
  const { W, H, m, y, grade } = moldura(el, pontos, 220);
  const faixa = (W - m.l - m.r) / pontos.length;
  const larg = Math.max(3, Math.min(24, faixa - 2));
  let barras = "", rotulos = "", alvos = "";
  pontos.forEach((p, i) => {
    const cx = m.l + faixa * i + faixa / 2;
    const v = p.valor ?? 0;
    if (v > 0) {
      const topo = y(v), base = y(0), r = Math.min(4, larg / 2, base - topo);
      barras += `<path d="M${cx - larg / 2},${base} V${topo + r} Q${cx - larg / 2},${topo} ${cx - larg / 2 + r},${topo} H${cx + larg / 2 - r} Q${cx + larg / 2},${topo} ${cx + larg / 2},${topo + r} V${base} Z" fill="${COR_SERIE}"/>`;
    }
    if (i % rotuloCada === 0 || i === pontos.length - 1)
      rotulos += `<text x="${cx}" y="${H - 8}" class="g-eixo" text-anchor="middle">${escapar(p.rotulo)}</text>`;
    alvos += `<rect x="${m.l + faixa * i}" y="${m.t}" width="${faixa}" height="${H - m.t - m.b}" fill="transparent" data-i="${i}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gráfico de barras">
    ${grade}<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>${barras}${rotulos}${alvos}</svg>`;
  el.querySelectorAll("rect[data-i]").forEach((r) => {
    const p = pontos[+r.dataset.i];
    const f = (ev) => mostrarDica(ev, `<b>${escapar(p.dica ?? p.rotulo)}</b><span>${fmt(p.valor)} ${unidade}</span>`);
    r.addEventListener("mousemove", f);
    r.addEventListener("touchstart", f, { passive: true });
    r.addEventListener("mouseleave", esconderDica);
  });
}

function graficoLinha(el, pontos, { unidade = "" } = {}) {
  if (pontos.length < 2) {
    el.innerHTML = "<div class='g-vazio'>" + (pontos.length ? "Só um treino registrado até agora — a linha aparece a partir do segundo." : "Nenhum registro deste exercício ainda.") + "</div>";
    return;
  }
  const { W, H, m, y, grade } = moldura(el, pontos, 220);
  const passo = (W - m.l - m.r) / (pontos.length - 1);
  const x = (i) => m.l + passo * i;
  const d = pontos.map((p, i) => (i ? "L" : "M") + x(i) + "," + y(p.valor)).join(" ");
  const area = d + ` L${x(pontos.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const cada = Math.ceil(pontos.length / 6);
  let marcas = "", rotulos = "";
  pontos.forEach((p, i) => {
    if (i % cada === 0 || i === pontos.length - 1)
      rotulos += `<text x="${x(i)}" y="${H - 8}" class="g-eixo" text-anchor="middle">${escapar(p.rotulo)}</text>`;
  });
  const u = pontos.length - 1;
  marcas = `<circle cx="${x(u)}" cy="${y(pontos[u].valor)}" r="5" fill="${COR_SERIE}" stroke="#fff" stroke-width="2"/>` +
    `<text x="${x(u) - 8}" y="${y(pontos[u].valor) - 10}" class="g-valor" text-anchor="end">${fmt(pontos[u].valor, 1)} ${unidade}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Gráfico de linha">
    ${grade}<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>
    <path d="${area}" fill="${COR_SERIE}" opacity=".1"/>
    <path d="${d}" fill="none" stroke="${COR_SERIE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${marcas}${rotulos}
    <line class="g-mira" x1="0" x2="0" y1="${m.t}" y2="${y(0)}" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent" class="g-alvo"/></svg>`;
  const svg = el.querySelector("svg"), mira = el.querySelector(".g-mira");
  const mover = (ev) => {
    const r = svg.getBoundingClientRect();
    const cx = ((ev.touches?.[0]?.clientX ?? ev.clientX) - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(u, Math.round((cx - m.l) / passo)));
    mira.setAttribute("x1", x(i)); mira.setAttribute("x2", x(i)); mira.setAttribute("visibility", "visible");
    const p = pontos[i];
    mostrarDica(ev, `<b>${escapar(p.dica ?? p.rotulo)}</b><span>${fmt(p.valor, 1)} ${unidade}</span>`);
  };
  const alvo = el.querySelector(".g-alvo");
  alvo.addEventListener("mousemove", mover);
  alvo.addEventListener("touchstart", mover, { passive: true });
  alvo.addEventListener("mouseleave", () => { esconderDica(); mira.setAttribute("visibility", "hidden"); });
}
document.addEventListener("scroll", esconderDica, true);

/* =========================================================
   CLASSIFICAÇÕES — as mesmas faixas do relatório mensal
   ========================================================= */
function classeACWR(m) {
  if (!m.historico_suficiente || m.acwr === null || m.acwr === undefined)
    return { txt: "aguardando histórico", cls: "", icone: "…" };
  if (m.acwr > 1.5) return { txt: "risco alto", cls: "vermelho", icone: "▲" };
  if (m.acwr > 1.3) return { txt: "acima da faixa", cls: "ambar", icone: "▲" };
  if (m.acwr < 0.8) return { txt: "abaixo da faixa", cls: "ambar", icone: "▼" };
  return { txt: "na faixa 0,8–1,3", cls: "verde", icone: "●" };
}
function classeMono(v) {
  if (v === null || v === undefined) return { txt: "sem variação suficiente", cls: "" };
  if (v > 2) return { txt: "alta — risco", cls: "vermelho" };
  if (v >= 1) return { txt: "ideal", cls: "verde" };
  return { txt: "baixa — boa variação", cls: "azul" };
}
function classeStrain(v) {
  if (v === null || v === undefined) return { txt: "—", cls: "" };
  if (v > 4500) return { txt: "alto", cls: "vermelho" };
  if (v >= 2500) return { txt: "moderado (ideal)", cls: "verde" };
  return { txt: "baixo", cls: "azul" };
}

/* =========================================================
   ALERTAS DO PAINEL
   ========================================================= */
async function carregarAlertas() {
  const tb = $("#tb-alertas");
  if (!estado.alunos.length) {
    tb.innerHTML = "<tr><td colspan='4' class='vazio'>Cadastre alunos para acompanhar a carga.</td></tr>";
    $("#alertas-sub").textContent = "";
    return;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const desde = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const ck = await sb.from("checkins").select("aluno_id,data,tqr,dor").gte("data", desde).order("data", { ascending: false });
  const checkins = ck.data ?? [];

  const alertas = [];
  await Promise.all(estado.alunos.map(async (a) => {
    const r = await sb.rpc("metricas_carga", { _aluno: a.id });
    if (!r.error && r.data) {
      const m = r.data;
      estado.metricas = estado.metricas ?? {};
      estado.metricas[a.id] = m;
      const c = classeACWR(m);
      if (c.cls === "vermelho" || c.cls === "ambar")
        alertas.push({ a, sinal: "ACWR " + c.txt, metrica: "ACWR " + fmt(m.acwr, 2), cls: c.cls, peso: c.cls === "vermelho" ? 3 : 2 });
      if (m.monotonia > 2) alertas.push({ a, sinal: "Monotonia alta", metrica: fmt(m.monotonia, 2), cls: "vermelho", peso: 2 });
      if (m.strain > 4500) alertas.push({ a, sinal: "Strain alto", metrica: fmt(m.strain) + " UA", cls: "vermelho", peso: 2 });
    }
    const seus = checkins.filter((x) => x.aluno_id === a.id);
    if (seus.length >= 2 && seus[0].tqr !== null && seus[1].tqr !== null && seus[0].tqr < 10 && seus[1].tqr < 10)
      alertas.push({ a, sinal: "Recuperação baixa 2 dias seguidos", metrica: "TQR " + seus[0].tqr + " e " + seus[1].tqr, cls: "vermelho", peso: 3 });
    const deHoje = seus.find((x) => x.data === hoje);
    const fortes = deHoje ? Object.entries(deHoje.dor || {}).filter(([, v]) => v >= 3).map(([k]) => REGIOES_DOR[k] ?? k) : [];
    if (fortes.length) alertas.push({ a, sinal: "Dor forte hoje", metrica: fortes.join(", "), cls: "vermelho", peso: 3 });
  }));

  alertas.sort((x, y) => y.peso - x.peso);
  $("#alertas-sub").textContent = alertas.length
    ? alertas.length + (alertas.length === 1 ? " sinal" : " sinais") : "nenhum sinal agora";
  tb.innerHTML = alertas.length
    ? alertas.map((x) =>
      "<tr><td><div class='quem-cel'><div class='av'>" + escapar(iniciais(x.a.nome)) + "</div><b>" + escapar(x.a.nome) + "</b></div></td>" +
      "<td><span class='pill " + x.cls + "'>" + (x.cls === "vermelho" ? "⚠ " : "") + escapar(x.sinal) + "</span></td>" +
      "<td class='mini'>" + escapar(x.metrica) + "</td>" +
      "<td><button class='btn ghost sm' data-perfil='" + x.a.id + "'>ver</button></td></tr>").join("")
    : "<tr><td colspan='4' class='vazio'>Tudo tranquilo: ninguém fora das faixas de carga nem com recuperação baixa.</td></tr>";
  ligarPerfis();
}

function ligarPerfis() {
  $$("[data-perfil]").forEach((b) => {
    if (b.dataset.ligado) return;
    b.dataset.ligado = "1";
    b.addEventListener("click", () => abrirPerfil(b.dataset.perfil));
  });
}

/* =========================================================
   PERFIL DO ALUNO (só treinador)
   ========================================================= */
const REGIOES_DOR = {
  pescoco: "Pescoço", ombro_d: "Ombro D", ombro_e: "Ombro E", cotovelo_punho: "Cotovelo/punho",
  costas: "Costas", lombar: "Lombar", quadril: "Quadril/glúteo", coxa: "Coxa",
  joelho_d: "Joelho D", joelho_e: "Joelho E", perna_tornozelo: "Panturrilha/tornozelo", outro: "Outro",
};
const NIVEL_DOR = ["", "leve", "moderada", "forte"];
const FASES = { menstrual: "Menstruação", folicular: "Pós-menstruação", ovulatoria: "Ovulação", lutea: "Pré-menstrual", nao_sei: "Não sei" };
const Q5_SONO = ["", "Péssima", "Ruim", "Ok", "Boa", "Ótima"];
const Q5_BEM = ["", "Muito mal", "Mal", "Normal", "Bem", "Muito bem"];

async function abrirPerfil(alunoId) {
  const a = estado.alunos.find((x) => x.id === alunoId);
  if (!a) return;
  estado.perfilAberto = a;
  irPara("perfil");
  $("#pf-nome").textContent = a.nome;
  $("#pf-sub").textContent = [a.objetivo, a.esporte, a.peso_kg ? a.peso_kg + " kg" : null].filter(Boolean).join(" · ") || "—";
  $$(".so-f").forEach((el) => (el.hidden = a.sexo !== "F"));
  $("#pf-stats").innerHTML = "<div class='carregando'>Calculando carga…</div>";
  $("#pf-graf-carga").innerHTML = "";

  const [m, ck, hist] = await Promise.all([
    comTratamento(sb.rpc("metricas_carga", { _aluno: alunoId }), "Não consegui calcular a carga"),
    comTratamento(sb.from("checkins").select("*").eq("aluno_id", alunoId)
      .gte("data", new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10))
      .order("data", { ascending: false }), "Não consegui carregar os check-ins"),
    carregarHistoricoExercicios(alunoId),
  ]);
  if (estado.perfilAberto?.id !== alunoId) return; // trocou de aluno no meio
  if (m.ok) desenharCarga(m.data);
  if (ck.ok) desenharCheckinsTreinador(ck.data ?? [], a.sexo === "F");
  desenharEvolucao();
  desenharRM(a);
  desenharPlanoNoPerfil(alunoId);
  desenharExtrasEAgua(alunoId);
}
$("#pf-voltar").addEventListener("click", () => irPara("alunos"));
$("#pf-prescrever").addEventListener("click", () => {
  if (estado.perfilAberto) $("#sel-aluno").value = estado.perfilAberto.id;
  irPara("prescrever");
});

function desenharCarga(m) {
  const ac = classeACWR(m), mo = classeMono(m.monotonia), st = classeStrain(m.strain);
  const falta = m.dias_ate_acwr > 0 ? "liga em " + m.dias_ate_acwr + (m.dias_ate_acwr === 1 ? " dia" : " dias") : "precisa de 4 semanas de registro";
  $("#pf-stats").innerHTML =
    "<div class='stat'><div class='v'>" + fmt(m.carga_7d) + "</div><div class='l'>Carga 7 dias (UA)</div>" +
      "<div class='d mini'>" + m.dias_7.filter((x) => x > 0).length + " dias com treino</div></div>" +
    "<div class='stat'><div class='v'>" + (m.historico_suficiente ? fmt(m.acwr, 2) : "—") + "</div><div class='l'>ACWR</div>" +
      "<div class='d'><span class='pill " + ac.cls + "'>" + ac.icone + " " + ac.txt + "</span>" +
      (m.historico_suficiente ? "" : " <span class='mini'>" + falta + "</span>") + "</div></div>" +
    "<div class='stat'><div class='v'>" + fmt(m.monotonia, 2) + "</div><div class='l'>Monotonia</div>" +
      "<div class='d'><span class='pill " + mo.cls + "'>" + mo.txt + "</span></div></div>" +
    "<div class='stat'><div class='v'>" + fmt(m.strain) + "</div><div class='l'>Strain (UA)</div>" +
      "<div class='d'><span class='pill " + st.cls + "'>" + st.txt + "</span></div></div>";

  const pontos = (m.carga_28_dias ?? []).map((d) => {
    const dt = new Date(d.dia + "T12:00:00");
    return { rotulo: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: Number(d.carga),
      dica: dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }) };
  });
  graficoBarras($("#pf-graf-carga"), pontos, { unidade: "UA", rotuloCada: 7 });

  $("#pf-semanas").innerHTML = (m.semanas ?? []).slice().reverse().map((s) => {
    const seg = new Date(s.segunda + "T12:00:00");
    const moS = classeMono(s.monotonia), stS = classeStrain(s.strain);
    return "<tr><td>" + seg.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) +
      (s.parcial ? " <span class='pill'>em andamento</span>" : "") + "</td>" +
      "<td><b>" + fmt(s.soma) + "</b> <span class='mini'>UA</span></td>" +
      "<td>" + (s.parcial ? "<span class='mini'>fecha no domingo</span>" : fmt(s.monotonia, 2) + " <span class='pill " + moS.cls + "'>" + moS.txt + "</span>") + "</td>" +
      "<td>" + (s.parcial ? "—" : fmt(s.strain) + (s.strain !== null ? " <span class='pill " + stS.cls + "'>" + stS.txt + "</span>" : "")) + "</td></tr>";
  }).join("");
}

function desenharCheckinsTreinador(lista, feminino) {
  const tb = $("#pf-checkins");
  if (!lista.length) {
    tb.innerHTML = "<tr><td colspan='7' class='vazio'>Nenhum check-in nos últimos 14 dias.</td></tr>";
    return;
  }
  tb.innerHTML = lista.map((c) => {
    const dores = Object.entries(c.dor || {}).filter(([, v]) => v > 0)
      .map(([k, v]) => "<span class='pill " + (v >= 3 ? "vermelho" : v === 2 ? "ambar" : "") + "'>" + escapar(REGIOES_DOR[k] ?? k) + " · " + NIVEL_DOR[v] + "</span>").join(" ");
    const tqrCls = c.tqr === null ? "" : c.tqr < 10 ? "vermelho" : c.tqr < 13 ? "ambar" : "verde";
    return "<tr><td>" + new Date(c.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + "</td>" +
      "<td>" + (c.sono_horas !== null ? fmt(c.sono_horas, 1) + " h" : "—") + "</td>" +
      "<td class='mini'>" + (Q5_SONO[c.sono_qual] || "—") + "</td>" +
      "<td class='mini'>" + (Q5_BEM[c.wellness] || "—") + "</td>" +
      "<td>" + (c.tqr !== null ? "<span class='pill " + tqrCls + "'>" + c.tqr + "</span>" : "—") + "</td>" +
      "<td>" + (dores || "<span class='mini'>sem dor</span>") + "</td>" +
      "<td class='so-f mini'" + (feminino ? "" : " hidden") + ">" + (c.ciclo?.fase ? escapar(FASES[c.ciclo.fase] ?? c.ciclo.fase) + (c.ciclo.sintomas ? " · com sintomas" : "") : "—") + "</td></tr>";
  }).join("");
}

/* ---------- histórico de carga por exercício ---------- */
async function carregarHistoricoExercicios(alunoId) {
  estado.histEx = {};
  estado.setsAluno = [];
  const sess = await sb.from("session_logs").select("id,data").eq("aluno_id", alunoId).eq("finalizada", true)
    .order("data", { ascending: true }).limit(400);
  if (sess.error || !sess.data?.length) return;
  const dataDe = {};
  sess.data.forEach((s) => (dataDe[s.id] = s.data));
  const ids = sess.data.map((s) => s.id);
  const sets = await sb.from("workout_sets").select("session_id,exercise_id,serie_num,carga_kg,reps,tempo_s,dist_m,concluida")
    .in("session_id", ids).eq("concluida", true);
  if (sets.error) return erro("Não consegui carregar o histórico por exercício");
  estado.setsAluno = (sets.data ?? []).map((x) => ({ ...x, data: dataDe[x.session_id] }));
  (sets.data ?? []).forEach((s) => {
    const ex = (estado.histEx[s.exercise_id] ??= {});
    const k = s.session_id;
    const reg = (ex[k] ??= { data: dataDe[k], series: 0, volume: 0, melhor: null });
    reg.series++;
    const kg = Number(s.carga_kg) || 0, r = Number(s.reps) || 0, t = Number(s.tempo_s) || 0, d = Number(s.dist_m) || 0;
    reg.volume += kg * r;
    const m = reg.melhor;
    if (!m || kg > m.kg || (kg === m.kg && (r > m.reps || t > m.t || d > m.d)))
      reg.melhor = { kg, reps: r, t, d, txt: descreverSerie(s) };
  });
  const sel = $("#pf-exercicio");
  const nomes = Object.keys(estado.histEx)
    .map((id) => ({ id, nome: estado.exercicios.find((e) => e.id === id)?.nome ?? "Exercício" }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  sel.innerHTML = nomes.length
    ? nomes.map((n) => "<option value='" + n.id + "'>" + escapar(n.nome) + "</option>").join("")
    : "<option value=''>sem registros ainda</option>";
}
$("#pf-exercicio").addEventListener("change", desenharEvolucao);

function desenharEvolucao() {
  const id = $("#pf-exercicio").value;
  const reg = id && estado.histEx?.[id] ? Object.values(estado.histEx[id]).sort((a, b) => a.data.localeCompare(b.data)) : [];
  $("#pf-ex-titulo").textContent = id ? (estado.exercicios.find((e) => e.id === id)?.nome ?? "Exercício") : "Nenhum exercício registrado ainda";
  // o gráfico acompanha o que o exercício tem: carga; se não houver, tempo; senão distância ou reps
  const eixo = reg.some((r) => r.melhor?.kg) ? ["kg", "kg", "maior carga levantada por treino"]
    : reg.some((r) => r.melhor?.t) ? ["t", "s", "maior tempo por treino"]
    : reg.some((r) => r.melhor?.d) ? ["d", "m", "maior distância por treino"] : ["reps", "reps", "mais repetições por treino"];
  $("#pf-ex-titulo").nextElementSibling && ($("#pf-ex-titulo").nextElementSibling.textContent = eixo[2]);
  graficoLinha($("#pf-graf-ex"), reg.map((r) => {
    const dt = new Date(r.data + "T12:00:00");
    return { rotulo: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: r.melhor?.[eixo[0]] ?? 0,
      dica: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " · " + (r.melhor?.txt ?? "") };
  }), { unidade: eixo[1] });
  $("#pf-ex-tabela").innerHTML = reg.length
    ? reg.slice().reverse().map((r) => "<tr><td>" + new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR") + "</td><td>" + r.series +
        "</td><td><b>" + (r.melhor?.txt ?? "—") + "</b></td><td>" + (r.volume ? fmt(r.volume) + " kg" : "—") + "</td></tr>").join("")
    : "<tr><td colspan='4' class='vazio'>Os registros aparecem quando o aluno concluir séries deste exercício.</td></tr>";
}

/* =========================================================
   CHECK-IN MATINAL (aluno)
   ========================================================= */
const TQR_ROTULOS = { 6: "Nada recuperado", 7: "Extremamente mal", 9: "Muito mal", 11: "Mal", 13: "Razoável", 15: "Bem", 17: "Muito bem", 19: "Extremamente bem", 20: "Totalmente recuperado" };
const hojeISO = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

async function carregarCheckinHoje() {
  const r = await sb.from("checkins").select("*").eq("aluno_id", estado.usuario.id).eq("data", hojeISO()).maybeSingle();
  al.checkinHoje = r.error ? null : r.data;
  return al.checkinHoje;
}

function desenharCheckin() {
  const c = al.checkinHoje ?? {};
  const f = (al.ck = {
    sono_horas: c.sono_horas ?? 7.5, sono_qual: c.sono_qual ?? null, wellness: c.wellness ?? null,
    tqr: c.tqr ?? null, dor: { ...(c.dor ?? {}) }, ciclo: { fase: c.ciclo?.fase ?? "", sintomas: !!c.ciclo?.sintomas },
  });
  const escala = (campo, rotulos) => "<div class='escala5'>" + [1, 2, 3, 4, 5].map((n) =>
    "<button type='button' data-esc='" + campo + ":" + n + "' class='" + (f[campo] === n ? "on" : "") + "'>" + rotulos[n] + "</button>").join("") + "</div>";
  const feminino = estado.perfil.sexo === "F";

  $("#checkin-form").innerHTML =
    (c.id ? "<div class='ck-feito'>✓ Check-in de hoje já enviado — você pode ajustar e salvar de novo.</div>" : "") +
    "<div class='ck-bloco'><h3>Quantas horas você dormiu?</h3>" +
      "<div class='passo'><button type='button' data-sono='-0.5'>−</button><b id='ck-sono'>" + fmt(f.sono_horas, 1) + " h</b><button type='button' data-sono='0.5'>+</button></div></div>" +
    "<div class='ck-bloco'><h3>Qualidade do sono</h3>" + escala("sono_qual", Q5_SONO) + "</div>" +
    "<div class='ck-bloco'><h3>Como você está se sentindo?</h3>" + escala("wellness", Q5_BEM) + "</div>" +
    "<div class='ck-bloco'><h3>Quanto você se sente recuperado?</h3><p class='mini'>Escala de 6 (nada) a 20 (totalmente recuperado)</p>" +
      "<div class='tqr-grade'>" + Array.from({ length: 15 }, (_, k) => k + 6).map((n) =>
        "<button type='button' data-tqr='" + n + "' class='" + (f.tqr === n ? "on" : "") + "'><b>" + n + "</b>" +
        (TQR_ROTULOS[n] ? "<span>" + TQR_ROTULOS[n] + "</span>" : "") + "</button>").join("") + "</div></div>" +
    "<div class='ck-bloco'><h3>Sente dor em algum lugar?</h3><p class='mini'>Toque para marcar: leve → moderada → forte → sem dor</p>" +
      "<div class='dor-grade'>" + Object.entries(REGIOES_DOR).map(([k, nome]) =>
        "<button type='button' data-dor='" + k + "' class='nivel-" + (f.dor[k] || 0) + "'>" + escapar(nome) +
        "<span>" + (NIVEL_DOR[f.dor[k] || 0] || "") + "</span></button>").join("") + "</div></div>" +
    (feminino ? "<div class='ck-bloco'><h3>Ciclo menstrual <span class='mini'>(opcional)</span></h3>" +
      "<select id='ck-fase' class='select-topo' style='margin:0;max-width:none;width:100%'>" +
      "<option value=''>Prefiro não informar</option>" +
      Object.entries(FASES).map(([k, n]) => "<option value='" + k + "'" + (f.ciclo.fase === k ? " selected" : "") + ">" + n + "</option>").join("") +
      "</select><label class='check' style='margin-top:10px'><input type='checkbox' id='ck-sintomas'" + (f.ciclo.sintomas ? " checked" : "") +
      "> Com sintomas hoje (cólica, inchaço, dor de cabeça…)</label></div>" : "") +
    "<div id='ck-erro' class='erro' hidden></div>" +
    "<button class='btn bloco' id='ck-salvar'>Enviar check-in</button>";

  $$("[data-sono]").forEach((b) => b.addEventListener("click", () => {
    f.sono_horas = Math.max(0, Math.min(16, (Number(f.sono_horas) || 0) + Number(b.dataset.sono)));
    $("#ck-sono").textContent = fmt(f.sono_horas, 1) + " h";
  }));
  $$("[data-esc]").forEach((b) => b.addEventListener("click", () => {
    const [campo, n] = b.dataset.esc.split(":");
    f[campo] = +n;
    $$("[data-esc^='" + campo + ":']").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $$("[data-tqr]").forEach((b) => b.addEventListener("click", () => {
    f.tqr = +b.dataset.tqr;
    $$("[data-tqr]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $$("[data-dor]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.dor, v = ((f.dor[k] || 0) + 1) % 4;
    if (v) f.dor[k] = v; else delete f.dor[k];
    b.className = "nivel-" + v;
    b.querySelector("span").textContent = NIVEL_DOR[v];
  }));
  $("#ck-salvar").addEventListener("click", salvarCheckin);
}

async function salvarCheckin() {
  const f = al.ck, e = $("#ck-erro");
  e.hidden = true;
  const falta = [!f.sono_qual && "qualidade do sono", !f.wellness && "como está se sentindo", !f.tqr && "recuperação"].filter(Boolean);
  if (falta.length) { e.textContent = "Falta responder: " + falta.join(", ") + "."; e.hidden = false; return; }
  const btn = $("#ck-salvar");
  btn.disabled = true; btn.textContent = "Enviando…";
  let ciclo = null;
  if (estado.perfil.sexo === "F" && $("#ck-fase")?.value)
    ciclo = { fase: $("#ck-fase").value, sintomas: $("#ck-sintomas").checked };
  const r = await comTratamento(
    sb.from("checkins").upsert({
      aluno_id: estado.usuario.id, data: hojeISO(), sono_horas: f.sono_horas, sono_qual: f.sono_qual,
      wellness: f.wellness, tqr: f.tqr, dor: f.dor, ciclo,
    }, { onConflict: "aluno_id,data" }).select().single(),
    "Não consegui enviar o check-in");
  btn.disabled = false; btn.textContent = "Enviar check-in";
  if (!r.ok) return;
  const conf = await carregarCheckinHoje();   // relê do banco antes de confirmar
  if (!conf || conf.tqr !== f.tqr) return erro("Enviei, mas não consegui confirmar. Tente de novo.");
  bom("Check-in enviado. Bom treino hoje!");
  desenharTreinosHoje();
  telaAluno("hoje");
}

function bannerCheckin() {
  return al.checkinHoje
    ? "<button class='atalho ck-banner feito' data-ir-ck>" + svgIcone("checkin") +
      "<span class='selo verde'>Feito</span><b>Check-in</b><small>✓ Check-in de hoje feito · ajustar</small></button>"
    : "<button class='atalho ck-banner' data-ir-ck>" + svgIcone("checkin") +
      "<span class='selo'>Hoje</span><b>Check-in</b><small>Como você acordou hoje?</small></button>";
}

function ligarBannerCheckin() {
  $$("[data-ir-ck]").forEach((b) => b.addEventListener("click", () => telaAluno("checkin")));
}

/* vídeo que não carrega vira aviso, em vez de ficar girando para sempre */
function protegerVideos(raiz = document) {
  raiz.querySelectorAll("video").forEach((v) => {
    if (v.dataset.protegido) return;
    v.dataset.protegido = "1";
    v.addEventListener("error", () => {
      const aviso = document.createElement("div");
      aviso.className = "sem-video-ex";
      aviso.textContent = "vídeo indisponível no momento — confira sua conexão";
      v.replaceWith(aviso);
    });
  });
}

/* =========================================================
   ETAPA 5 — PERIODIZAÇÃO (treinador)
   Motor por regras, não "IA": fases do modelo clássico (Matveev/Bompa)
   ou blocos ATR (Issurin), capacidades biomotoras por esporte
   (Bompa & Buzzichelli), ondas 3:1 e polimento no fim.
   ========================================================= */
const ESPORTES = {
  volei:      { n: "Vôlei",        caps: { forca: 4, potencia: 5, plio: 5, veloc: 4, agil: 4, anaer: 3, aer: 2, mob: 3 } },
  futebol:    { n: "Futebol",      caps: { forca: 3, potencia: 4, plio: 3, veloc: 5, agil: 5, anaer: 4, aer: 4, mob: 3 } },
  basquete:   { n: "Basquete",     caps: { forca: 3, potencia: 5, plio: 5, veloc: 4, agil: 4, anaer: 4, aer: 3, mob: 2 } },
  corrida:    { n: "Corrida",      caps: { forca: 2, potencia: 2, plio: 2, veloc: 2, agil: 1, anaer: 3, aer: 5, mob: 3 } },
  ciclismo:   { n: "Ciclismo",     caps: { forca: 3, potencia: 3, plio: 1, veloc: 2, agil: 1, anaer: 4, aer: 5, mob: 2 } },
  natacao:    { n: "Natação",      caps: { forca: 4, potencia: 3, plio: 1, veloc: 3, agil: 1, anaer: 4, aer: 4, mob: 5 } },
  tenis:      { n: "Tênis",        caps: { forca: 3, potencia: 4, plio: 3, veloc: 4, agil: 5, anaer: 4, aer: 3, mob: 3 } },
  lutas:      { n: "Lutas / MMA",  caps: { forca: 4, potencia: 4, plio: 3, veloc: 3, agil: 4, anaer: 5, aer: 3, mob: 4 } },
  crossfit:   { n: "CrossFit",     caps: { forca: 4, potencia: 4, plio: 3, veloc: 3, agil: 3, anaer: 4, aer: 4, mob: 3 } },
  musculacao: { n: "Musculação",   caps: { forca: 5, potencia: 2, plio: 1, veloc: 1, agil: 1, anaer: 2, aer: 2, mob: 2 } },
};
const CAPNOMES = { forca: "Força", potencia: "Potência", plio: "Pliometria", veloc: "Velocidade", agil: "Agilidade",
  anaer: "Resist. anaeróbia", aer: "Resist. aeróbia", mob: "Mobilidade" };
const FASE_BASE = { "Prep. Geral": 0.62, "Prep. Específica": 0.8, "Pré-competitivo": 0.95, "Competitivo": 0.75, "Transição": 0.4,
  "Acumulação": 0.7, "Transformação": 0.9, "Realização": 0.65 };

function esporteDoPerfil(txt) {
  const t = normalizar(txt);
  if (!t) return "musculacao";
  const achado = Object.entries(ESPORTES).find(([k, e]) => t.includes(normalizar(e.n).split(" ")[0]) || t.includes(k));
  if (achado) return achado[0];
  if (/mma|jiu|judo|boxe|muay|luta/.test(t)) return "lutas";
  if (/bike|pedal/.test(t)) return "ciclismo";
  if (/hipertrof|emagrec|saude|estetic/.test(t)) return "musculacao";
  return "musculacao";
}

function fasesDoPlano(semanas, modelo) {
  if (modelo === "atr") {
    const seq = [["Acumulação", 4], ["Transformação", 3], ["Realização", 2]];
    const out = []; let resta = semanas, i = 0;
    while (resta > 0) { const [n, w] = seq[i % 3]; const x = Math.min(w, resta); out.push({ n, w: x }); resta -= x; i++; }
    return out;
  }
  const div = [["Prep. Geral", 0.30], ["Prep. Específica", 0.25], ["Pré-competitivo", 0.20], ["Competitivo", 0.15], ["Transição", 0.10]];
  let acc = 0;
  const out = div.map(([n, f], k) => {
    let w = Math.max(1, Math.round(semanas * f));
    if (k === div.length - 1) w = Math.max(1, semanas - acc);
    acc += w;
    return { n, w };
  });
  let total = out.reduce((s, p) => s + p.w, 0);
  while (total > semanas) { const maior = out.reduce((a, b) => (b.w > a.w ? b : a)); maior.w--; total--; }
  while (total < semanas) { out[0].w++; total++; }
  return out.filter((p) => p.w > 0);
}
function focoDaFase(fase, caps) {
  const top = Object.entries(caps).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const f = {
    "Prep. Geral": ["aer", "forca", "mob"], "Prep. Específica": [top[0], top[1], "forca"],
    "Pré-competitivo": [top[0], top[1], top[2]], "Competitivo": [top[0], "veloc", "mob"], "Transição": ["mob", "aer"],
    "Acumulação": ["aer", "forca", "mob"], "Transformação": [top[0], top[1], "anaer"], "Realização": [top[0], "veloc", "mob"],
  };
  return [...new Set(f[fase] || top.slice(0, 3))].slice(0, 3);
}
function nivelPlio(idx, total) {
  const r = idx / (total - 1 || 1);
  if (r < 0.3) return ["Baixa", "saltos no lugar, corda, skipping"];
  if (r < 0.6) return ["Moderada", "box jumps, bounds, medicine ball"];
  if (r < 0.85) return ["Alta (método de choque)", "drop jumps, saltos em profundidade"];
  return ["Reativa / manutenção", "saltos específicos do gesto esportivo"];
}
function cargasSemanais(fases) {
  const onda = [1, 1.1, 1.22, 0.68];
  const out = [];
  fases.forEach((f) => {
    for (let i = 0; i < f.w; i++) out.push({ fase: f.n, v: (FASE_BASE[f.n] || 0.7) * onda[i % 4], descarga: i % 4 === 3 });
  });
  if (out.length > 2) { out[out.length - 2].v *= 0.6; out[out.length - 1].v *= 0.45; out[out.length - 2].polimento = out[out.length - 1].polimento = true; }
  return out;
}
function microciclo(fase, caps, sess) {
  const top = Object.entries(caps).sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const geral = /Geral|Acumulação|Transição/.test(fase);
  const pico = /Pré-comp|Competitivo|Realização|Transformação/.test(fase);
  const menu = {
    plio: { t: "Pliometria / potência", d: nivelPlio(pico ? 2 : 0, 4)[1], int: "alta" },
    veloc: { t: "Velocidade / agilidade", d: "sprints curtos, mudanças de direção", int: "alta" },
    agil: { t: "Velocidade / agilidade", d: "sprints curtos, mudanças de direção", int: "alta" },
    forca: { t: "Força", d: geral ? "força geral, base estrutural, 8–12 reps" : "força máxima/específica, 3–6 reps", int: "alta" },
    potencia: { t: "Potência de força", d: "levantamentos balísticos, 3–5 reps rápidas", int: "alta" },
    anaer: { t: "Condicionamento anaeróbio", d: "intervalados intensos, sprints repetidos", int: "moderada" },
    aer: { t: "Base aeróbia", d: "contínuo/regenerativo, zona 2", int: "baixa" },
    mob: { t: "Mobilidade / recuperação", d: "mobilidade, core, tecido mole", int: "baixa" },
  };
  const fila = [];
  focoDaFase(fase, caps).forEach((k) => menu[k] && !fila.includes(k) && fila.push(k));
  top.forEach((k) => menu[k] && !fila.includes(k) && fila.push(k));
  ["mob", "aer"].forEach((k) => !fila.includes(k) && fila.push(k));
  const altas = fila.filter((k) => menu[k].int === "alta"), leves = fila.filter((k) => menu[k].int !== "alta");
  const dias = []; let a = 0, l = 0;
  for (let i = 0; i < sess; i++) {
    let k;
    if (i % 2 === 0 && a < altas.length) k = altas[a++];
    else if (l < leves.length) k = leves[l++];
    else if (a < altas.length) k = altas[a++];
    else k = fila[i % fila.length];
    dias.push(k);
  }
  if (pico && sess >= 3) dias[dias.length - 1] = "mob";
  return dias.map((k, i) => ({ dia: i + 1, ...menu[k] }));
}
function rotuloSemana(v, max) {
  const r = v / (max || 1);
  return r < 0.55 ? "leve" : r < 0.8 ? "moderada" : "alta";
}

/* monta o plano completo (o que vai para o banco) */
function gerarPlano({ esporte, semanas, sessoes, modelo, base, inicio }) {
  const caps = ESPORTES[esporte].caps;
  const fases = fasesDoPlano(semanas, modelo);
  const cargas = cargasSemanais(fases);
  const maxV = Math.max(...cargas.map((c) => c.v));
  const semanasPlano = cargas.map((c, i) => {
    const foco = focoDaFase(c.fase, caps);
    return {
      n: i + 1, fase: c.fase, v: +c.v.toFixed(3), ua: Math.round(base * c.v / 0.8),
      rotulo: c.descarga || c.polimento ? "leve" : rotuloSemana(c.v, maxV),
      descarga: !!c.descarga, polimento: !!c.polimento,
      foco_aluno: foco.map((k) => CAPNOMES[k].toLowerCase()).join(" + "),
    };
  });
  const mesos = fases.map((f, idx) => {
    const [plio, plioDesc] = nivelPlio(idx, fases.length);
    return { fase: f.n, semanas: f.w, foco: focoDaFase(f.n, caps).map((k) => CAPNOMES[k]), plio, plioDesc };
  });
  const chave = fases.find((f) => /Específica|Transformação/.test(f.n)) ?? fases[0];
  const fim = new Date(inicio + "T12:00:00"); fim.setDate(fim.getDate() + semanas * 7 - 1);
  return {
    modelo, inicio, fim: fim.toISOString().slice(0, 10),
    fases: {
      versao: 1, esporte, esporte_nome: ESPORTES[esporte].n, sessoes, base_ua: base, semanas_total: semanas, modelo,
      caps, fases, semanas: semanasPlano, mesos, fase_chave: chave.n, micro: microciclo(chave.n, caps, sessoes),
    },
  };
}

/* ---------- tela do planejador ---------- */
const per = { esporte: "musculacao", modelo: "classico", plano: null, atual: null };

function proximaSegunda() {
  const d = new Date(); d.setHours(12);
  const dia = d.getDay();
  d.setDate(d.getDate() + (dia === 1 ? 0 : (8 - dia) % 7));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function montarPeriodizacao(alunoId) {
  const sel = $("#per-aluno");
  sel.innerHTML = estado.alunos.length
    ? estado.alunos.map((a) => "<option value='" + a.id + "'>" + escapar(a.nome) + "</option>").join("")
    : "<option value=''>Cadastre um aluno primeiro</option>";
  if (alunoId) sel.value = alunoId;
  $("#per-sessoes").innerHTML = [2, 3, 4, 5, 6, 7].map((n) => "<option" + (n === 4 ? " selected" : "") + ">" + n + "</option>").join("");
  if (!$("#per-inicio").value) $("#per-inicio").value = proximaSegunda();
  trocarAlunoPer();
}
function desenharEsportes() {
  $("#per-esportes").innerHTML = Object.entries(ESPORTES).map(([k, e]) =>
    "<button type='button' class='chip" + (k === per.esporte ? " on" : "") + "' data-esporte='" + k + "'>" + e.n + "</button>").join("");
  $$("[data-esporte]").forEach((b) => b.addEventListener("click", () => { per.esporte = b.dataset.esporte; desenharEsportes(); }));
}
async function trocarAlunoPer() {
  const a = estado.alunos.find((x) => x.id === $("#per-aluno").value);
  per.esporte = esporteDoPerfil(a?.esporte || a?.objetivo);
  desenharEsportes();
  $("#per-ativo").hidden = true;
  $("#per-base").value = "";
  $("#per-base-dica").textContent = "Usada para calcular a carga planejada de cada semana.";
  if (!a) return;
  const [plano, m] = await Promise.all([
    sb.from("periodization").select("*").eq("aluno_id", a.id).order("criado_em", { ascending: false }).limit(1),
    sb.rpc("metricas_carga", { _aluno: a.id }),
  ]);
  if ($("#per-aluno").value !== a.id) return;
  const sess = parseInt($("#per-sessoes").value) || 4;
  const cron = Number(m.data?.cronica_media) || 0;
  $("#per-base").value = cron > 0 ? Math.round(cron) : sess * 360;
  $("#per-base-dica").textContent = cron > 0
    ? "Média das últimas 4 semanas de " + a.nome.split(" ")[0] + ". Pode ajustar."
    : "Sem histórico suficiente: estimativa de " + sess + " sessões × 60 min × PSE 6. Pode ajustar.";
  per.atual = plano.data?.[0] ?? null;
  if (per.atual) {
    const f = per.atual.fases ?? {};
    $("#per-ativo").innerHTML = "<b>Plano ativo:</b> " + escapar(f.esporte_nome ?? "") + " · " + (f.semanas_total ?? "?") +
      " semanas · início " + new Date(per.atual.inicio + "T12:00:00").toLocaleDateString("pt-BR") +
      " <button type='button' class='link-sutil' id='per-ver-ativo'>ver</button>";
    $("#per-ativo").hidden = false;
    $("#per-ver-ativo").addEventListener("click", () => { per.plano = { modelo: per.atual.modelo, inicio: per.atual.inicio, fim: per.atual.fim, fases: per.atual.fases }; desenharPlano(true); });
  }
}
$("#per-aluno").addEventListener("change", trocarAlunoPer);
$$("#per-modelo button").forEach((b) => b.addEventListener("click", () => {
  per.modelo = b.dataset.modelo;
  $$("#per-modelo button").forEach((x) => x.classList.toggle("on", x === b));
}));
$("#per-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const cErro = $("#per-erro"); cErro.hidden = true;
  const semanas = parseInt($("#per-semanas").value);
  const base = parseInt($("#per-base").value);
  const inicio = $("#per-inicio").value;
  const falha = (m) => { cErro.textContent = m; cErro.hidden = false; };
  if (!$("#per-aluno").value) return falha("Cadastre um aluno primeiro.");
  if (!(semanas >= 4 && semanas <= 52)) return falha("A temporada precisa ter entre 4 e 52 semanas.");
  if (!inicio) return falha("Escolha a data de início.");
  if (!(base > 0 && base < 20000)) return falha("Informe a carga semanal de referência (UA).");
  per.plano = gerarPlano({ esporte: per.esporte, semanas, sessoes: parseInt($("#per-sessoes").value) || 4, modelo: per.modelo, base, inicio });
  desenharPlano(false);
});

const COR_FASE = ["#bfe0fb", "#8fc7f6", "#5aaaf1", "#2f97ef", "#1a74c9", "#1455b0", "#0f3f85"];
function faixaFases(fases, total) {
  return "<div class='macro'>" + fases.map((f, i) =>
    "<div class='ph' style='flex:" + f.w + ";background:" + (f.n === "Transição" ? "#c9d2df" : COR_FASE[Math.min(i, COR_FASE.length - 1)]) +
    ";color:" + (i >= 3 && f.n !== "Transição" ? "#fff" : "var(--text)") + "' title='" + escapar(f.n) + " · " + f.w + " sem'><b>" +
    escapar(f.n) + "</b><span>" + f.w + " sem</span></div>").join("") + "</div>";
}
function desenharPlano(salvo) {
  const p = per.plano, f = p.fases;
  const caps = Object.entries(f.caps).sort((a, b) => b[1] - a[1]);
  const aluno = estado.alunos.find((x) => x.id === $("#per-aluno").value);
  $("#per-resultado").innerHTML =
    "<div class='card'><div class='card-tit'><h2>" + escapar(f.esporte_nome) + " · " + escapar(aluno?.nome?.split(" ")[0] ?? "") + "</h2>" +
      "<span class='mini'>" + f.semanas_total + " semanas · " + f.sessoes + " sessões/sem · " + (f.modelo === "atr" ? "Blocos ATR (Issurin)" : "Clássico (Matveev/Bompa)") + "</span></div>" +
      faixaFases(f.fases, f.semanas_total) +
      "<p class='mini' style='margin-top:8px'>" + new Date(p.inicio + "T12:00:00").toLocaleDateString("pt-BR") + " → " +
      new Date(p.fim + "T12:00:00").toLocaleDateString("pt-BR") + "</p></div>" +

    "<div class='card'><div class='card-tit'><h2>Carga semanal planejada</h2><span class='mini'>ondas 3:1 e polimento nas 2 últimas semanas · UA</span></div>" +
      "<div class='grafico' id='per-graf'></div></div>" +

    "<div class='grid g2 per-duo'><div class='card'><h2 class='h2c'>Prioridade das capacidades</h2><div class='caps'>" +
      caps.map(([k, v]) => "<div class='cap'><span>" + CAPNOMES[k] + "</span><div class='trilho'><i style='width:" + v * 20 + "%'></i></div><b>" + v + "</b></div>").join("") +
    "</div></div><div class='card'><h2 class='h2c'>Microciclo da fase-chave · " + escapar(f.fase_chave) + "</h2><div class='micro'>" +
      f.micro.map((d) => "<div class='drow'><span class='dd'>Sessão " + d.dia + "</span><div><b>" + escapar(d.t) + "</b><span>" + escapar(d.d) + "</span></div>" +
        "<span class='pill " + (d.int === "alta" ? "vermelho" : d.int === "moderada" ? "ambar" : "verde") + "'>" + d.int + "</span></div>").join("") +
      "</div><p class='mini' style='margin-top:10px'>Neural primeiro (velocidade, potência, pliometria), força depois, resistência por último; 48h entre sessões intensas da mesma qualidade.</p></div></div>" +

    "<div class='sechd'><h2>Mesociclos</h2></div><div class='mesos'>" +
      f.mesos.map((m, i) => "<div class='card meso'><span class='meso-n' style='background:" + (m.fase === "Transição" ? "#c9d2df" : COR_FASE[Math.min(i, COR_FASE.length - 1)]) + "'></span>" +
        "<b>" + escapar(m.fase) + "</b><span class='mini'>" + m.semanas + " semana" + (m.semanas > 1 ? "s" : "") + "</span>" +
        "<div class='meso-l'><span>Foco</span>" + m.foco.map(escapar).join(" · ") + "</div>" +
        "<div class='meso-l'><span>Pliometria</span>" + escapar(m.plio) + " — " + escapar(m.plioDesc) + "</div></div>").join("") + "</div>" +

    "<div class='per-acoes'>" + (salvo ? "<span class='mini'>Este é o plano salvo. Gere outro para substituí-lo.</span>"
      : "<button class='btn' id='per-salvar'>Salvar plano para o aluno</button><span class='mini'>O aluno vê só a fase, a semana e rótulos (leve/moderada/alta) — nunca UA.</span>") + "</div>" +
    "<p class='mini per-refs'>Bases: Bompa &amp; Buzzichelli (fases e capacidades biomotoras); Bompa &amp; Haff; Issurin (blocos ATR); Matveev (modelo clássico); Verkhoshansky (pliometria/choque).</p>";

  graficoBarras($("#per-graf"), f.semanas.map((s) => ({
    rotulo: "S" + s.n, valor: s.ua,
    dica: "Semana " + s.n + " · " + s.fase + (s.descarga ? " · descarga" : s.polimento ? " · polimento" : ""),
  })), { unidade: "UA", rotuloCada: f.semanas.length > 20 ? 4 : f.semanas.length > 12 ? 2 : 1 });
  $("#per-salvar")?.addEventListener("click", salvarPlano);
}
async function salvarPlano() {
  const btn = $("#per-salvar");
  const alunoId = $("#per-aluno").value;
  btn.disabled = true; btn.textContent = "Salvando…";
  const p = per.plano;
  const r = await comTratamento(
    sb.from("periodization").insert({ treinador_id: estado.usuario.id, aluno_id: alunoId, modelo: p.modelo,
      inicio: p.inicio, fim: p.fim, fases: p.fases }).select().single(),
    "Não consegui salvar o plano");
  if (!r.ok) { btn.disabled = false; btn.textContent = "Salvar plano para o aluno"; return; }
  const conf = await sb.from("periodization").select("id,fases").eq("id", r.data.id).maybeSingle();
  if (!conf.data || conf.data.fases?.semanas?.length !== p.fases.semanas.length) {
    btn.disabled = false; btn.textContent = "Salvar plano para o aluno";
    return erro("O plano foi enviado, mas a conferência não bateu. Recarregue e verifique.");
  }
  bom("Plano salvo — " + estado.alunos.find((a) => a.id === alunoId)?.nome.split(" ")[0] + " já vê a fase no calendário");
  per.atual = r.data;
  desenharPlano(true);
  trocarAlunoPer();
}

/* ---------- no perfil do aluno: planejado × realizado ---------- */
async function desenharPlanoNoPerfil(alunoId) {
  const alvo = $("#pf-plano");
  const r = await sb.from("periodization").select("*").eq("aluno_id", alunoId).order("criado_em", { ascending: false }).limit(1);
  if (estado.perfilAberto?.id !== alunoId) return;
  const p = r.data?.[0];
  if (!p || !p.fases?.semanas?.length) {
    alvo.innerHTML = "<div class='g-vazio'>Nenhuma periodização salva para este aluno. <a class='link-sutil' data-abrir-plano>Criar agora</a></div>";
    alvo.querySelector("[data-abrir-plano]").addEventListener("click", abrirPlanejador);
    return;
  }
  const f = p.fases;
  const hoje = hojeISO();
  const semAtual = Math.floor((new Date(hoje + "T12:00:00") - new Date(p.inicio + "T12:00:00")) / (7 * 864e5)) + 1;
  const ate = hoje < p.fim ? hoje : p.fim;
  const real = {};
  if (hoje >= p.inicio) {
    const c = await sb.rpc("carga_diaria", { _aluno: alunoId, _de: p.inicio, _ate: ate });
    (c.data ?? []).forEach((d) => {
      const n = Math.floor((new Date(d.dia + "T12:00:00") - new Date(p.inicio + "T12:00:00")) / (7 * 864e5)) + 1;
      real[n] = (real[n] ?? 0) + Number(d.carga);
    });
  }
  const s = f.semanas.find((x) => x.n === semAtual);
  const feitas = f.semanas.filter((x) => x.n < semAtual);
  const aderencia = feitas.length ? feitas.reduce((acc, x) => acc + Math.min(1.5, (real[x.n] ?? 0) / (x.ua || 1)), 0) / feitas.length : null;
  alvo.innerHTML =
    "<div class='plano-topo'><div><span class='mini'>" + escapar(f.esporte_nome) + " · " + (p.modelo === "atr" ? "Blocos ATR" : "Clássico") + "</span>" +
    "<b>" + (semAtual < 1 ? "Começa em " + new Date(p.inicio + "T12:00:00").toLocaleDateString("pt-BR")
      : semAtual > f.semanas.length ? "Plano concluído" : escapar(s.fase) + " · semana " + semAtual + " de " + f.semanas.length) + "</b>" +
    (s ? "<span class='mini'>foco: " + escapar(s.foco_aluno) + (s.descarga ? " · semana de descarga" : "") + "</span>" : "") + "</div>" +
    (aderencia != null ? "<div class='aderencia'><b>" + Math.round(aderencia * 100) + "%</b><span class='mini'>carga realizada ÷ planejada</span></div>" : "") + "</div>" +
    faixaFases(f.fases, f.semanas.length) +
    "<div class='legenda'><span><i class='lg-plan'></i>Planejado</span><span><i class='lg-real'></i>Realizado</span></div>" +
    "<div class='grafico' id='pf-graf-plano'></div>";
  graficoPlanReal($("#pf-graf-plano"), f.semanas.map((x) => ({
    rotulo: "S" + x.n, plan: x.ua, real: x.n <= semAtual ? Math.round(real[x.n] ?? 0) : null, atual: x.n === semAtual,
    dica: "Semana " + x.n + " · " + x.fase,
  })));
}
function abrirPlanejador() {
  irPara("periodizacao");
  montarPeriodizacao(estado.perfilAberto?.id);
}
$("#pf-ir-plano").addEventListener("click", abrirPlanejador);

/* duas séries: planejado (cinza, referência) e realizado (azul) */
function graficoPlanReal(el, pontos) {
  const { W, H, m, y, grade } = moldura(el, pontos.map((p) => ({ valor: Math.max(p.plan, p.real ?? 0) })), 220);
  const faixa = (W - m.l - m.r) / pontos.length;
  const larg = Math.max(2, Math.min(12, faixa / 2 - 2));
  const barra = (cx, v, cor) => {
    if (!v) return "";
    const topo = y(v), base = y(0), r = Math.min(3, larg / 2, base - topo);
    return `<path d="M${cx - larg / 2},${base} V${topo + r} Q${cx - larg / 2},${topo} ${cx - larg / 2 + r},${topo} H${cx + larg / 2 - r} Q${cx + larg / 2},${topo} ${cx + larg / 2},${topo + r} V${base} Z" fill="${cor}"/>`;
  };
  const cada = pontos.length > 20 ? 4 : pontos.length > 12 ? 2 : 1;
  let marcas = "", rot = "", alvos = "";
  pontos.forEach((p, i) => {
    const cx = m.l + faixa * i + faixa / 2;
    marcas += barra(cx - larg / 2 - 1, p.plan, "#c9d2df") + barra(cx + larg / 2 + 1, p.real, COR_SERIE);
    if (p.atual) marcas += `<rect x="${m.l + faixa * i}" y="${m.t}" width="${faixa}" height="${H - m.t - m.b}" fill="${COR_SERIE}" opacity=".06"/>`;
    if (i % cada === 0 || i === pontos.length - 1)
      rot += `<text x="${cx}" y="${H - 8}" class="g-eixo" text-anchor="middle"${p.atual ? ' style="font-weight:800;fill:var(--azul-dim)"' : ""}>${escapar(p.rotulo)}</text>`;
    alvos += `<rect x="${m.l + faixa * i}" y="${m.t}" width="${faixa}" height="${H - m.t - m.b}" fill="transparent" data-i="${i}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Carga planejada e realizada por semana">
    ${grade}<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>${marcas}${rot}${alvos}</svg>`;
  el.querySelectorAll("rect[data-i]").forEach((r) => {
    const p = pontos[+r.dataset.i];
    const f = (ev) => mostrarDica(ev, `<b>${escapar(p.dica)}</b><span>planejado ${fmt(p.plan)} UA</span>` +
      `<span>${p.real == null ? "ainda não chegou" : "realizado " + fmt(p.real) + " UA"}</span>`);
    r.addEventListener("mousemove", f);
    r.addEventListener("touchstart", f, { passive: true });
    r.addEventListener("mouseleave", esconderDica);
  });
}

/* =========================================================
   1RM ESTIMADO (treinador) — Epley e Brzycki, relativo ao peso
   ========================================================= */
const epley = (kg, reps) => (reps <= 1 ? kg : kg * (1 + reps / 30));
const brzycki = (kg, reps) => (reps <= 1 ? kg : kg * 36 / (37 - reps));
/* padrões de força relativa (× peso corporal): [novato, intermediário, avançado, elite] */
const PADRAO_FORCA = {
  agachamento: { M: [1.0, 1.5, 2.0, 2.5], F: [0.5, 1.0, 1.5, 2.0] },
  terra:       { M: [1.25, 1.75, 2.25, 2.75], F: [0.6, 1.1, 1.6, 2.1] },
  supino:      { M: [0.75, 1.25, 1.75, 2.25], F: [0.4, 0.7, 1.0, 1.3] },
  desenvolvimento: { M: [0.5, 0.75, 1.0, 1.35], F: [0.3, 0.45, 0.6, 0.85] },
  remada:      { M: [0.6, 1.0, 1.4, 1.8], F: [0.35, 0.6, 0.9, 1.2] },
};
function liftDe(nome) {
  const t = normalizar(nome);
  if (/agachamento (livre|com barra|back)|^agachamento$|back squat/.test(t)) return "agachamento";
  if (/levantamento terra|^terra|deadlift/.test(t) && !/romeno|stiff/.test(t)) return "terra";
  if (/supino reto (com )?barra|^supino reto$|bench/.test(t)) return "supino";
  if (/desenvolvimento (militar|com barra)|overhead|ohp/.test(t)) return "desenvolvimento";
  if (/remada curvada/.test(t)) return "remada";
  return null;
}
function nivelForca(lift, rel, sexo) {
  const s = PADRAO_FORCA[lift]?.[sexo === "F" ? "F" : "M"];
  if (!s || !sexo) return null;
  if (rel < s[0]) return ["Iniciante", ""];
  if (rel < s[1]) return ["Novato", ""];
  if (rel < s[2]) return ["Intermediário", "azul"];
  if (rel < s[3]) return ["Avançado", "verde"];
  return ["Elite", "roxo"];
}
function desenharRM(aluno) {
  const sets = estado.setsAluno ?? [];
  const porEx = {};
  sets.forEach((s) => {
    const kg = Number(s.carga_kg), reps = Number(s.reps);
    if (!(kg > 0 && reps >= 1)) return;
    const reg = (porEx[s.exercise_id] ??= { melhor: null, longas: 0 });
    if (reps > 12) { reg.longas++; return; }
    const e = epley(kg, reps), b = brzycki(kg, reps), med = (e + b) / 2;
    if (!reg.melhor || med > reg.melhor.med) reg.melhor = { kg, reps, e, b, med, data: s.data };
  });
  const linhas = Object.entries(porEx).map(([id, r]) => ({ id, nome: estado.exercicios.find((e) => e.id === id)?.nome ?? "Exercício", ...r }))
    .filter((r) => r.melhor || r.longas)
    .sort((a, b) => (b.melhor?.med ?? 0) - (a.melhor?.med ?? 0));
  const peso = Number(aluno.peso_kg) || null;
  $("#rm-sub").textContent = "média de Epley e Brzycki · séries de até 12 reps" + (peso ? " · peso " + fmtNum(peso) + " kg" : " · sem peso no cadastro");
  $("#pf-rm").innerHTML = linhas.length ? linhas.map((r) => {
    if (!r.melhor) return "<tr><td><b>" + escapar(r.nome) + "</b></td><td colspan='6' class='mini'>só séries acima de 12 reps — estimativa pouco confiável</td></tr>";
    const m = r.melhor, rel = peso ? m.med / peso : null;
    const lift = liftDe(r.nome), nv = rel ? nivelForca(lift, rel, aluno.sexo) : null;
    return "<tr><td><b>" + escapar(r.nome) + "</b></td><td>" + fmtNum(m.kg) + " kg × " + m.reps +
      (m.reps > 10 ? " <span class='pill ambar' title='Acima de 10 reps a estimativa perde precisão'>série longa</span>" : "") +
      "<div class='mini'>" + (m.data ? new Date(m.data + "T12:00:00").toLocaleDateString("pt-BR") : "") + "</div></td>" +
      "<td>" + fmt(m.e, 1) + "</td><td>" + fmt(m.b, 1) + "</td><td><b>" + fmt(m.med, 1) + " kg</b></td>" +
      "<td>" + (rel ? fmt(rel, 2) + "×" : "<span class='mini'>sem peso</span>") + "</td>" +
      "<td>" + (nv ? "<span class='pill " + nv[1] + "'>" + nv[0] + "</span>" : "<span class='mini'>—</span>") + "</td></tr>";
  }).join("") : "<tr><td colspan='7' class='vazio'>Aparece quando o aluno registrar séries de carga × reps.</td></tr>";
}

/* ---------- treinos adicionais e hidratação vistos pelo treinador ---------- */
async function desenharExtrasEAgua(alunoId) {
  const de28 = new Date(Date.now() - 27 * 864e5).toISOString().slice(0, 10);
  const de7 = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  const [ex, hid] = await Promise.all([
    sb.from("extra_sessions").select("*").eq("aluno_id", alunoId).gte("data", de28).order("data", { ascending: false }),
    sb.from("hidratacao").select("*").eq("aluno_id", alunoId).gte("data", de7).order("data"),
  ]);
  if (estado.perfilAberto?.id !== alunoId) return;
  $("#pf-extras").innerHTML = (ex.data ?? []).length ? ex.data.map((e) =>
    "<tr><td>" + new Date(e.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + "</td><td><b>" + escapar(e.tipo) + "</b>" +
    (e.descricao ? "<div class='mini'>" + escapar(e.descricao) + "</div>" : "") + "</td><td>" + (e.duracao_min ?? "—") + " min</td><td>" + (e.pse ?? "—") +
    "</td><td>" + (e.pse && e.duracao_min ? fmt(e.pse * e.duracao_min) : "—") + "</td></tr>").join("")
    : "<tr><td colspan='5' class='vazio'>Nenhuma atividade extra registrada.</td></tr>";
  const dias = Array.from({ length: 7 }, (_, k) => new Date(Date.now() - (6 - k) * 864e5).toISOString().slice(0, 10));
  const por = {}; (hid.data ?? []).forEach((h) => (por[h.data] = h));
  const meta = (d) => por[d]?.meta_ml || metaAguaPadrao(estado.perfilAberto?.peso_kg, false);
  const pct = dias.map((d) => (por[d] ? Math.min(1.5, por[d].ml / meta(d)) : 0));
  const comReg = pct.filter((x, k) => por[dias[k]]);
  $("#pf-agua").innerHTML = "<div class='agua-sem'>" + dias.map((d, k) =>
    "<div class='agua-d' title='" + (por[d] ? fmtNum(por[d].ml / 1000) + " L de " + fmtNum(meta(d) / 1000) + " L" : "sem registro") + "'>" +
    "<div class='agua-col'><i style='height:" + Math.min(100, Math.round(pct[k] * 100)) + "%'></i></div>" +
    "<span>" + ["D", "S", "T", "Q", "Q", "S", "S"][new Date(d + "T12:00:00").getDay()] + "</span></div>").join("") + "</div>" +
    "<p class='mini'>" + (comReg.length ? "Média " + Math.round(comReg.reduce((a, b) => a + Math.min(1, b), 0) / comReg.length * 100) +
      "% da meta " + (comReg.length === 1 ? "no único dia com registro." : "nos " + comReg.length + " dias com registro.") : "Nenhum registro de água nesta semana.") + "</p>";
}

/* =========================================================
   ALUNO — treino extra, hidratação e calendário
   Regra: o aluno vê rótulos (leve/moderado/alta), nunca UA.
   ========================================================= */
const TIPOS_EXTRA = ["Corrida", "Caminhada", "Bike", "Natação", "Yoga", "Pilates", "Futebol", "Luta", "Outro"];
const ex5 = { tipo: null, min: 40, pse: null, quando: 0 };

function desenharExtraForm() {
  ex5.tipo = null; ex5.min = 40; ex5.pse = null; ex5.quando = 0;
  $("#extra-form").innerHTML =
    "<div class='ck-bloco'><h3>O que você fez?</h3><div class='chips' id='ex-tipos'>" +
      TIPOS_EXTRA.map((t) => "<button type='button' class='chip' data-tipo='" + t + "'>" + t + "</button>").join("") + "</div>" +
      "<input id='ex-desc' class='campo-linha' maxlength='120' placeholder='Detalhe (opcional): ex. 5 km leve, aula de vinyasa'></div>" +
    "<div class='ck-bloco'><h3>Quando?</h3><div class='fmode'><button type='button' class='on' data-quando='0'>Hoje</button><button type='button' data-quando='1'>Ontem</button></div></div>" +
    "<div class='ck-bloco'><h3>Duração</h3><div class='passo'><button type='button' data-min='-5'>−</button><b id='ex-min'>40 min</b><button type='button' data-min='5'>+</button></div></div>" +
    "<div class='ck-bloco'><h3>Quão puxado foi?</h3><div class='pse-legenda'><span>muito leve</span><span>máximo</span></div>" +
      "<div class='pse-grade'>" + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => "<button type='button' data-expse='" + n + "'>" + n + "</button>").join("") + "</div>" +
      "<p class='mini' id='ex-rot'>Toque para avaliar o esforço</p></div>" +
    "<div id='ex-erro' class='erro' hidden></div>" +
    "<button class='btn bloco' id='ex-salvar'>Registrar atividade</button>" +
    "<p class='mini ex-porque'>Se você treina por fora e seu treinador não sabe, ele pode achar que você está descansado. Registrar tudo protege você de excesso e lesão.</p>";
  $$("[data-tipo]").forEach((b) => b.addEventListener("click", () => {
    ex5.tipo = b.dataset.tipo; $$("[data-tipo]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $$("[data-quando]").forEach((b) => b.addEventListener("click", () => {
    ex5.quando = +b.dataset.quando; $$("[data-quando]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  $$("[data-min]").forEach((b) => b.addEventListener("click", () => {
    ex5.min = Math.max(5, Math.min(480, ex5.min + +b.dataset.min)); $("#ex-min").textContent = ex5.min + " min";
  }));
  $$("[data-expse]").forEach((b) => b.addEventListener("click", () => {
    ex5.pse = +b.dataset.expse; $$("[data-expse]").forEach((x) => x.classList.toggle("on", x === b));
    $("#ex-rot").textContent = "Esforço " + rotuloPSE(ex5.pse);
  }));
  $("#ex-salvar").addEventListener("click", salvarExtra);
}
async function salvarExtra() {
  const cErro = $("#ex-erro"); cErro.hidden = true;
  const falta = [!ex5.tipo && "o que você fez", !ex5.pse && "o esforço"].filter(Boolean);
  if (falta.length) { cErro.textContent = "Falta responder: " + falta.join(" e ") + "."; cErro.hidden = false; return; }
  const btn = $("#ex-salvar"); btn.disabled = true; btn.textContent = "Salvando…";
  const d = new Date(); d.setDate(d.getDate() - ex5.quando);
  const data = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const r = await comTratamento(sb.from("extra_sessions").insert({
    aluno_id: estado.usuario.id, tipo: ex5.tipo, descricao: $("#ex-desc").value.trim() || null,
    duracao_min: ex5.min, pse: ex5.pse, data,
  }).select().single(), "Não consegui registrar a atividade");
  btn.disabled = false; btn.textContent = "Registrar atividade";
  if (!r.ok) return;
  const conf = await sb.from("extra_sessions").select("id").eq("id", r.data.id).maybeSingle();
  if (!conf.data) { cErro.textContent = "Não consegui confirmar o registro. Tente de novo."; cErro.hidden = false; return; }
  bom(ex5.tipo + " registrado — entra na sua carga");
  desenharExtraForm();
  carregarExtrasAluno();
}
async function carregarExtrasAluno() {
  const seg = new Date(); seg.setDate(seg.getDate() - ((seg.getDay() + 6) % 7));
  const de = seg.getFullYear() + "-" + String(seg.getMonth() + 1).padStart(2, "0") + "-" + String(seg.getDate()).padStart(2, "0");
  const r = await sb.from("extra_sessions").select("*").eq("aluno_id", estado.usuario.id).gte("data", de).order("data", { ascending: false });
  const lista = r.data ?? [];
  $("#extra-sub").textContent = lista.length ? lista.length + (lista.length === 1 ? " registro" : " registros") : "";
  $("#extra-lista").innerHTML = lista.length ? lista.map((e) =>
    "<div class='hist-item'><div class='linha1'><b>" + escapar(e.tipo) + "</b><span class='pill'>" +
    new Date(e.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" }) + "</span>" +
    "<button class='rm-extra' data-rmextra='" + e.id + "' title='Apagar'>×</button></div>" +
    "<div class='dados'>" + (e.descricao ? escapar(e.descricao) + " · " : "") + e.duracao_min + " min · esforço " + rotuloPSE(e.pse) + "</div></div>").join("")
    : "<div class='vazio-hoje'><b>Nada extra nesta semana</b>Treinou por fora? Registre acima.</div>";
  $$("[data-rmextra]").forEach((b) => b.addEventListener("click", async () => {
    const x = await comTratamento(sb.from("extra_sessions").delete().eq("id", b.dataset.rmextra), "Não consegui apagar");
    if (x.ok) { bom("Atividade apagada"); carregarExtrasAluno(); }
  }));
}

/* ---------- hidratação ---------- */
const DICAS_AGUA = [
  ["Antes do treino", "Chegue já hidratado — comece a beber horas antes, não só na hora."],
  ["Durante", "Em treinos de até 1 hora, água costuma bastar. Goles regulares valem mais que tudo de uma vez."],
  ["Treinos longos ou no calor", "Acima de 1 hora ou suando muito, bebidas com eletrólitos ajudam a repor o sódio."],
  ["Como saber se está bem", "Urina clara indica boa hidratação; quanto mais escura, mais atenção."],
];
function metaAguaPadrao(peso, treinou) {
  const base = Math.round(((Number(peso) || 70) * 35) / 100) * 100;
  return Math.max(1500, Math.min(6000, base + (treinou ? 500 : 0)));
}
const ag = { ml: 0, meta: 0, historico: [] };
async function carregarAgua() {
  const hoje = hojeISO();
  const [h, sess, extras] = await Promise.all([
    sb.from("hidratacao").select("*").eq("aluno_id", estado.usuario.id).eq("data", hoje).maybeSingle(),
    sb.from("session_logs").select("id").eq("aluno_id", estado.usuario.id).eq("data", hoje).limit(1),
    sb.from("extra_sessions").select("id").eq("aluno_id", estado.usuario.id).eq("data", hoje).limit(1),
  ]);
  const treinou = (sess.data ?? []).length > 0 || (extras.data ?? []).length > 0 || al.treinos.some((t) => t.data === hoje);
  ag.ml = h.data?.ml ?? 0;
  ag.meta = estado.perfil.meta_agua_ml || h.data?.meta_ml || metaAguaPadrao(estado.perfil.peso_kg, treinou);
  ag.treinou = treinou;
  desenharAtalhosAluno();
  if ($("[data-tela='agua']").classList.contains("on")) desenharAgua();
}
function desenharAgua() {
  const pct = Math.min(1, ag.ml / ag.meta);
  const C = 2 * Math.PI * 70;
  $("#agua-sub").textContent = estado.perfil.meta_agua_ml ? "Meta definida por você." :
    "Meta calculada pelo seu peso" + (ag.treinou ? " + 500 ml porque hoje é dia de treino." : ".");
  $("#agua-corpo").innerHTML =
    "<div class='agua-card'><div class='agua-anel'><svg viewBox='0 0 160 160'><circle class='fundo' cx='80' cy='80' r='70'/>" +
      "<circle class='arco' cx='80' cy='80' r='70' stroke-dasharray='" + C.toFixed(1) + "' stroke-dashoffset='" + (C * (1 - pct)).toFixed(1) + "'/></svg>" +
      "<div class='agua-meio'><b id='agua-ml'>" + fmtNum(ag.ml / 1000) + " L</b><span>de " + fmtNum(ag.meta / 1000) + " L</span></div></div>" +
      "<p class='agua-status'>" + (pct >= 1 ? "Meta de hoje batida!" : "Faltam " + fmtNum((ag.meta - ag.ml) / 1000) + " L") + "</p>" +
      "<div class='agua-botoes'>" + [200, 300, 500, 750].map((ml) => "<button data-agua='" + ml + "'><b>+" + ml + "</b><span>ml</span></button>").join("") + "</div>" +
      "<div class='agua-rodape'><button class='link-sutil' id='agua-desfazer'" + (ag.historico.length ? "" : " hidden") + ">desfazer último</button>" +
      "<button class='link-sutil' id='agua-meta'>ajustar minha meta</button></div></div>" +
    "<div class='sechd'><h2>Dicas de hidratação</h2></div>" +
    DICAS_AGUA.map(([t, d]) => "<div class='ck-bloco dica'><b>" + t + "</b><p>" + d + "</p></div>").join("") +
    "<p class='mini' style='margin-top:6px'>Orientações gerais. Plano alimentar e suplementação são com o seu nutricionista.</p>";
  $$("[data-agua]").forEach((b) => b.addEventListener("click", () => somarAgua(+b.dataset.agua)));
  $("#agua-desfazer").addEventListener("click", () => { const u = ag.historico.pop(); if (u) somarAgua(-u, true); });
  $("#agua-meta").addEventListener("click", ajustarMetaAgua);
}
async function somarAgua(ml, desfazendo) {
  ag.ml = Math.max(0, ag.ml + ml);             // resposta imediata; o banco confirma logo depois
  if (!desfazendo) ag.historico.push(ml);
  desenharAgua();
  const r = await comTratamento(sb.rpc("adicionar_agua", { _data: hojeISO(), _ml: ml, _meta: ag.meta }), "Não consegui salvar a água");
  if (!r.ok) { ag.ml = Math.max(0, ag.ml - ml); if (!desfazendo) ag.historico.pop(); desenharAgua(); return; }
  ag.ml = r.data?.ml ?? ag.ml;                  // vale o que está no banco
  desenharAgua();
  desenharAtalhosAluno();
}
function ajustarMetaAgua() {
  abrirModal("<h3>Minha meta de água</h3><p class='desc'>Deixe em branco para o app calcular pelo seu peso (35 ml por kg, +500 ml em dia de treino).</p>" +
    "<label class='campo'><span>Meta diária (ml)</span><input id='meta-ml' type='number' inputmode='numeric' min='500' max='10000' step='100' value='" + (estado.perfil.meta_agua_ml ?? "") + "' placeholder='" + metaAguaPadrao(estado.perfil.peso_kg, ag.treinou) + "'></label>" +
    "<div id='meta-erro' class='erro' hidden></div>" +
    "<div class='acoes'><button class='btn ghost' id='meta-cancelar'>Cancelar</button><button class='btn' id='meta-salvar'>Salvar</button></div>");
  $("#meta-cancelar").addEventListener("click", fecharModal);
  $("#meta-salvar").addEventListener("click", async () => {
    const v = $("#meta-ml").value.trim(); const n = v ? parseInt(v) : null;
    if (n != null && !(n >= 500 && n <= 10000)) { $("#meta-erro").textContent = "Use um valor entre 500 e 10.000 ml."; $("#meta-erro").hidden = false; return; }
    const r = await comTratamento(sb.from("profiles").update({ meta_agua_ml: n }).eq("id", estado.usuario.id).select().single(), "Não consegui salvar a meta");
    if (!r.ok) return;
    estado.perfil.meta_agua_ml = r.data.meta_agua_ml;
    fecharModal();
    await carregarAgua();
    desenharAgua();
    bom("Meta atualizada");
  });
}

/* ---------- calendário ---------- */
const cal = { mes: null, plano: undefined, dias: {} };
const ROT_CAL = { leve: "Leve", moderada: "Moderada", alta: "Alta" };
function rotuloDia(pse) { return !pse ? null : pse <= 4 ? "leve" : pse <= 6 ? "moderada" : "alta"; }
async function abrirCalendario() {
  if (!cal.mes) { const d = new Date(); cal.mes = new Date(d.getFullYear(), d.getMonth(), 1, 12); }
  const [p] = await Promise.all([sb.rpc("plano_do_aluno"), carregarMesCal()]);
  cal.plano = p.error ? null : p.data;
  desenharPlanoAluno();
  desenharMesCal();
}
async function carregarMesCal() {
  const a = cal.mes, ini = new Date(a.getFullYear(), a.getMonth(), 1, 12), fim = new Date(a.getFullYear(), a.getMonth() + 1, 0, 12);
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const [s, e] = await Promise.all([
    sb.from("session_logs").select("data,pse,duracao_min,workout_id,finalizada").eq("aluno_id", estado.usuario.id).eq("finalizada", true).gte("data", iso(ini)).lte("data", iso(fim)),
    sb.from("extra_sessions").select("data,pse,duracao_min,tipo").eq("aluno_id", estado.usuario.id).gte("data", iso(ini)).lte("data", iso(fim)),
  ]);
  const nomes = {}; al.treinos.forEach((t) => (nomes[t.id] = t.nome));
  cal.dias = {};
  (s.data ?? []).forEach((x) => (cal.dias[x.data] ??= []).push({ nome: nomes[x.workout_id] ?? "Treino", pse: x.pse, min: x.duracao_min }));
  (e.data ?? []).forEach((x) => (cal.dias[x.data] ??= []).push({ nome: x.tipo + " (extra)", pse: x.pse, min: x.duracao_min }));
}
function desenharPlanoAluno() {
  const p = cal.plano, alvo = $("#cal-plano");
  if (!p || !p.semanas?.length) { alvo.innerHTML = ""; return; }
  const n = p.semana_atual, s = p.semanas.find((x) => x.n === n);
  const titulo = n < 1 ? "Seu plano começa em " + new Date(p.inicio + "T12:00:00").toLocaleDateString("pt-BR")
    : n > p.total ? "Plano concluído — fale com seu treinador sobre o próximo" : s.fase;
  const prox = p.semanas.filter((x) => x.n > Math.max(0, n)).slice(0, 3);
  alvo.innerHTML = "<div class='plano-aluno'><span class='tag'>" + escapar(p.esporte ?? "Seu plano") + "</span>" +
    "<b>" + escapar(titulo) + "</b>" +
    (s ? "<span>Semana " + n + " de " + p.total + " · foco: " + escapar(s.foco ?? "") + "</span>" : "") +
    "<div class='sem-trilho'>" + p.semanas.map((x) => "<i class='r-" + x.rotulo + (x.n === n ? " atual" : "") + (x.n < n ? " passou" : "") + "' title='Semana " + x.n + ": " + ROT_CAL[x.rotulo] + "'></i>").join("") + "</div>" +
    (prox.length ? "<div class='prox'>" + prox.map((x) => "<div><span>Semana " + x.n + "</span><b>" + (x.descarga ? "Regenerativa" : ROT_CAL[x.rotulo]) + "</b><em>" + escapar(x.fase) + "</em></div>").join("") + "</div>" : "") +
    "</div>";
}
function desenharMesCal() {
  const a = cal.mes, ano = a.getFullYear(), mes = a.getMonth();
  const primeiro = new Date(ano, mes, 1, 12), dias = new Date(ano, mes + 1, 0, 12).getDate();
  const offset = (primeiro.getDay() + 6) % 7; // semana começa na segunda
  const hoje = hojeISO();
  let grade = ["S", "T", "Q", "Q", "S", "S", "D"].map((d) => "<span class='dh'>" + d + "</span>").join("");
  for (let i = 0; i < offset; i++) grade += "<span></span>";
  for (let d = 1; d <= dias; d++) {
    const iso = ano + "-" + String(mes + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const itens = cal.dias[iso] ?? [];
    const pse = Math.max(0, ...itens.map((x) => x.pse || 0));
    const rot = itens.length ? rotuloDia(pse) || "leve" : null;
    grade += "<button class='dia" + (iso === hoje ? " hoje" : "") + (rot ? " r-" + rot : "") + "' data-dia='" + iso + "'" + (itens.length ? "" : " disabled") + ">" +
      d + (itens.length ? "<i></i>" : "") + "</button>";
  }
  const nomeMes = primeiro.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const nome = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
  $("#cal-mes").innerHTML = "<div class='ck-bloco'><div class='cal-topo'><button data-mes='-1' aria-label='Mês anterior'>‹</button><b>" + nome + "</b><button data-mes='1' aria-label='Próximo mês'>›</button></div>" +
    "<div class='cal-grade'>" + grade + "</div>" +
    "<div class='cal-leg'><span><i class='r-leve'></i>Leve</span><span><i class='r-moderada'></i>Moderada</span><span><i class='r-alta'></i>Alta</span></div>" +
    "<div id='cal-dia'></div></div>";
  $$("[data-mes]").forEach((b) => b.addEventListener("click", async () => {
    cal.mes = new Date(ano, mes + +b.dataset.mes, 1, 12);
    $("#cal-mes").style.opacity = ".5";
    await carregarMesCal();
    $("#cal-mes").style.opacity = "";
    desenharMesCal();
  }));
  $$("[data-dia]").forEach((b) => b.addEventListener("click", () => {
    $$(".dia.sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel");
    const itens = cal.dias[b.dataset.dia] ?? [];
    $("#cal-dia").innerHTML = "<div class='cal-det'><b>" + new Date(b.dataset.dia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) + "</b>" +
      itens.map((x) => "<div>" + escapar(x.nome) + " · " + (x.min ? x.min + " min · " : "") + "esforço " + rotuloPSE(x.pse) + "</div>").join("") + "</div>";
  }));
}

/* =========================================================
   PRONTIDÃO DO DIA (TQR) — quem está recuperado para treinar
   TQR 6–20 (Kenttä & Hassmén): quanto maior, mais recuperado.
   ========================================================= */
const faixaTQR = (t) =>
  t == null ? { cls: "", txt: "sem check-in" }
  : t <= 9 ? { cls: "vermelho", txt: "baixa", icone: "⚠ " }
  : t <= 13 ? { cls: "ambar", txt: "média", icone: "" }
  : t <= 16 ? { cls: "verde", txt: "boa", icone: "" }
  : { cls: "verde", txt: "ótima", icone: "" };

function barrinhasTQR(porDia, dias) {
  return "<div class='spark'>" + dias.map((d) => {
    const c = porDia[d];
    const t = c?.tqr ?? null;
    const f = faixaTQR(t);
    const alt = t == null ? 0 : Math.max(12, Math.round(((t - 6) / 14) * 100));
    const rot = new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    return "<i class='" + (t == null ? "vazio" : f.cls) + "' style='--h:" + alt + "%' title='" +
      rot + ": " + (t == null ? "sem check-in" : "TQR " + t + " · " + f.txt) + "'></i>";
  }).join("") + "</div>";
}

async function carregarProntidao() {
  const tb = $("#tb-prontidao");
  if (!tb) return;
  if (!estado.alunos.length) {
    tb.innerHTML = "<tr><td colspan='6' class='vazio'>Cadastre alunos para acompanhar a prontidão.</td></tr>";
    $("#pront-sub").textContent = "";
    return;
  }
  const dias = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - k));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  });
  const hoje = dias[6], ontem = dias[5];
  const r = await comTratamento(
    sb.from("checkins").select("aluno_id,data,tqr,dor,sono_horas,sono_qual,wellness").gte("data", dias[0]),
    "Não consegui carregar os check-ins de hoje");
  if (!r.ok) return;

  const por = {};
  (r.data ?? []).forEach((c) => ((por[c.aluno_id] ??= {})[c.data] = c));
  const linhas = estado.alunos.map((a) => {
    const meus = por[a.id] ?? {};
    const c = meus[hoje] ?? null;
    const ant = meus[ontem] ?? null;
    const delta = c?.tqr != null && ant?.tqr != null ? c.tqr - ant.tqr : null;
    const dores = Object.entries(c?.dor ?? {}).filter(([, v]) => v > 0)
      .sort((x, y) => y[1] - x[1]).map(([k, v]) => (REGIOES_DOR[k] ?? k) + " · " + NIVEL_DOR[v]);
    return { a, c, delta, dores, meus, ordem: c?.tqr ?? 99 };
  }).sort((x, y) => x.ordem - y.ordem || x.a.nome.localeCompare(y.a.nome, "pt-BR"));

  const responderam = linhas.filter((l) => l.c).length;
  const baixos = linhas.filter((l) => l.c?.tqr != null && l.c.tqr <= 9).length;
  $("#pront-sub").textContent = responderam + " de " + linhas.length + " fizeram o check-in hoje" +
    (baixos ? " · " + baixos + (baixos === 1 ? " com prontidão baixa" : " com prontidão baixa") : "");

  tb.innerHTML = linhas.map((l) => {
    const f = faixaTQR(l.c?.tqr ?? null);
    const seta = l.delta == null || l.delta === 0 ? "" :
      "<span class='mini delta " + (l.delta > 0 ? "sobe" : "desce") + "'>" + (l.delta > 0 ? "▲ +" : "▼ ") + l.delta + " vs ontem</span>";
    return "<tr><td><div class='quem-cel'><div class='av'>" + escapar(iniciais(l.a.nome)) + "</div><b>" + escapar(l.a.nome) + "</b></div></td>" +
      "<td>" + (l.c?.tqr != null
        ? "<div class='tqr-cel'><b>" + l.c.tqr + "</b><span class='pill " + f.cls + "'>" + (f.icone ?? "") + f.txt + "</span>" + seta +
          (TQR_ROTULOS[l.c.tqr] ? "<span class='mini'>" + TQR_ROTULOS[l.c.tqr] + "</span>" : "") + "</div>"
        : "<span class='mini'>sem check-in hoje</span>") + "</td>" +
      "<td class='mini'>" + (l.c?.sono_horas != null ? fmt(l.c.sono_horas, 1) + " h" + (l.c.sono_qual ? " · " + Q5_SONO[l.c.sono_qual].toLowerCase() : "") : "—") + "</td>" +
      "<td class='mini'>" + (l.dores.length ? escapar(l.dores.slice(0, 2).join(", ")) + (l.dores.length > 2 ? " +" + (l.dores.length - 2) : "") : "sem dor") + "</td>" +
      "<td>" + barrinhasTQR(l.meus, dias) + "</td>" +
      "<td class='acoes-linha'><button class='btn ghost sm' data-pront='" + l.a.id + "'>ver aluno</button></td></tr>";
  }).join("");
  $$("[data-pront]").forEach((b) => b.addEventListener("click", () => abrirPerfil(b.dataset.pront)));
}

/* =========================================================
   MINHA PROGRESSÃO (aluno) — carga externa por exercício.
   O aluno vê kg, reps, tempo e volume: o que ele mesmo levantou.
   Nada de UA, ACWR, monotonia ou strain aqui.
   ========================================================= */
const prog = { dados: null, ex: null };

async function abrirProgresso() {
  const alvo = $("#prog-corpo");
  if (!prog.dados) alvo.innerHTML = "<div class='carregando'>Carregando sua evolução…</div>";
  const sess = await comTratamento(
    sb.from("session_logs").select("id,data").eq("aluno_id", estado.usuario.id).eq("finalizada", true)
      .order("data", { ascending: true }).limit(300),
    "Não consegui carregar seus treinos");
  if (!sess.ok) return;
  const lista = sess.data ?? [];
  if (!lista.length) {
    prog.dados = {};
    alvo.innerHTML = "<div class='vazio-hoje'><b>Ainda não há treinos concluídos</b>Termine um treino e sua evolução começa a aparecer aqui.</div>";
    return;
  }
  const dataDe = {}; lista.forEach((x) => (dataDe[x.id] = x.data));
  const sets = await comTratamento(
    sb.from("workout_sets").select("session_id,exercise_id,carga_kg,reps,tempo_s,dist_m")
      .in("session_id", lista.map((x) => x.id)).eq("concluida", true),
    "Não consegui carregar suas séries");
  if (!sets.ok) return;

  const dados = {};
  (sets.data ?? []).forEach((s) => {
    const ex = (dados[s.exercise_id] ??= {});
    const d = (ex[s.session_id] ??= { data: dataDe[s.session_id], series: 0, volume: 0, melhor: null });
    d.series++;
    const kg = Number(s.carga_kg) || 0, r = Number(s.reps) || 0, t = Number(s.tempo_s) || 0, dm = Number(s.dist_m) || 0;
    d.volume += kg * r;
    const m = d.melhor;
    if (!m || kg > m.kg || (kg === m.kg && (r > m.reps || t > m.t || dm > m.d)))
      d.melhor = { kg, reps: r, t, d: dm, txt: descreverSerie(s) };
  });
  prog.dados = dados;
  if (!prog.ex || !dados[prog.ex]) {
    const ids = Object.keys(dados);
    prog.ex = ids.sort((a, b) => Object.keys(dados[b]).length - Object.keys(dados[a]).length)[0] ?? null;
  }
  desenharProgresso();
}

function desenharProgresso() {
  const alvo = $("#prog-corpo");
  const nomes = Object.keys(prog.dados ?? {})
    .map((id) => ({ id, nome: al.exercicios[id]?.nome ?? "Exercício", n: Object.keys(prog.dados[id]).length }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  if (!nomes.length) {
    alvo.innerHTML = "<div class='vazio-hoje'><b>Nada registrado ainda</b>Marque as séries durante o treino e a evolução aparece aqui.</div>";
    return;
  }
  const reg = Object.values(prog.dados[prog.ex]).sort((a, b) => a.data.localeCompare(b.data));
  const eixo = reg.some((r) => r.melhor?.kg) ? ["kg", "kg", "maior carga de cada treino"]
    : reg.some((r) => r.melhor?.t) ? ["t", "s", "maior tempo de cada treino"]
    : reg.some((r) => r.melhor?.d) ? ["d", "m", "maior distância de cada treino"] : ["reps", "reps", "mais repetições de cada treino"];
  const valores = reg.map((r) => r.melhor?.[eixo[0]] ?? 0);
  const primeiro = valores.find((v) => v > 0) ?? 0;
  const ultimo = [...valores].reverse().find((v) => v > 0) ?? 0;
  const varPct = primeiro > 0 ? Math.round(((ultimo - primeiro) / primeiro) * 100) : null;
  const recorde = Math.max(0, ...valores);
  const volumeTotal = reg.reduce((s, r) => s + r.volume, 0);
  const unid = eixo[1] === "s" ? "" : " " + eixo[1];
  const mostra = (v) => (eixo[1] === "s" ? fmtTempo(v) : fmt(v, v % 1 ? 1 : 0) + unid);

  alvo.innerHTML =
    "<label class='campo'><span>Exercício</span><select id='prog-sel'>" +
      nomes.map((n) => "<option value='" + n.id + "'" + (n.id === prog.ex ? " selected" : "") + ">" + escapar(n.nome) +
        " (" + n.n + (n.n === 1 ? " treino" : " treinos") + ")</option>").join("") + "</select></label>" +
    "<div class='prog-cards'>" +
      "<div class='prog-card'><b>" + mostra(ultimo) + "</b><span>última vez</span></div>" +
      "<div class='prog-card'><b>" + mostra(recorde) + "</b><span>seu recorde</span></div>" +
      (varPct != null && reg.length > 1
        ? "<div class='prog-card " + (varPct > 0 ? "sobe" : varPct < 0 ? "desce" : "") + "'><b>" + (varPct > 0 ? "+" : "") + varPct + "%</b><span>desde o 1º treino</span></div>"
        : "<div class='prog-card'><b>" + reg.length + "</b><span>" + (reg.length === 1 ? "treino" : "treinos") + "</span></div>") +
    "</div>" +
    "<div class='ck-bloco'><div class='card-tit'><h3>" + escapar(al.exercicios[prog.ex]?.nome ?? "") + "</h3><span class='mini'>" + eixo[2] + "</span></div>" +
      "<div class='grafico' id='prog-graf'></div></div>" +
    (volumeTotal ? "<p class='mini prog-vol'>Volume acumulado neste exercício: <b>" + fmt(volumeTotal) + " kg</b> levantados (carga × repetições).</p>" : "") +
    "<div class='sechd'><h2>Treino a treino</h2><span class='mini'>mais recente primeiro</span></div>" +
    "<div id='prog-lista'>" + reg.slice().reverse().map((r) =>
      "<div class='hist-item'><div class='linha1'><b>" + (r.melhor?.txt ?? "—") + "</b><span class='pill'>" +
      new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + "</span></div>" +
      "<div class='dados'>" + r.series + (r.series === 1 ? " série" : " séries") +
      (r.volume ? " · " + fmt(r.volume) + " kg de volume" : "") + "</div></div>").join("") + "</div>";

  graficoLinha($("#prog-graf"), reg.map((r) => {
    const dt = new Date(r.data + "T12:00:00");
    return { rotulo: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), valor: r.melhor?.[eixo[0]] ?? 0,
      dica: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }) + " · " + (r.melhor?.txt ?? "") };
  }), { unidade: eixo[1] });
  $("#prog-sel").addEventListener("change", (e) => { prog.ex = e.target.value; desenharProgresso(); });
}
