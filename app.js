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
  exercícios: [],
  treino: { id: null, nome: "", itens: [] },
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
    $("#aluno-ola").textContent = "Olá, " + estado.perfil.nome.split(" ")[0] + "!";
    mostrarTela("aluno");
  }
}

function irPara(pagina) {
  $$(".page").forEach((p) => p.classList.toggle("on", p.dataset.page === pagina));
  $$(".navitem").forEach((b) => b.classList.toggle("on", b.dataset.nav === pagina));
  $("#main").scrollTo(0, 0);
  window.scrollTo(0, 0);
  if (pagina === "biblioteca") desenharBiblioteca();
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
    "'>-</td><td><button class='btn ghost sm' data-prescrever='" + a.id + "'>prescrever</button></td></tr>"
  ).join("");

  $$("[data-prescrever]").forEach((b) =>
    b.addEventListener("click", () => {
      $("#sel-aluno").value = b.dataset.prescrever;
      irPara("prescrever");
    }));

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

function exercíciosFiltrados() {
  const { modo, chip, busca } = estado.filtro;
  return estado.exercicios.filter((ex) => {
    const campo = modo === "grupo" ? ex.grupo : ex.padrao;
    const okChip = chip === "Todos" || normalizar(campo) === normalizar(chip);
    const okBusca = !busca || normalizar(ex.nome).includes(normalizar(busca));
    return okChip && okBusca;
  });
}

function desenharLib() {
  const lista = exercíciosFiltrados();
  $("#liblist").innerHTML = lista.length
    ? lista.map((ex) => {
        const dentro = estado.treino.itens.some((i) => i.exercise_id === ex.id);
        return "<button class='libitem " + (dentro ? "dentro" : "") + "' data-add='" + ex.id + "'>" +
          "<div class='th " + (ex.video_url ? "" : "semvideo") + "'><svg viewBox='0 0 24 24'><path d='M8 5v14l11-7z'/></svg></div>" +
          "<div><b>" + escapar(ex.nome) + "</b><div class='m'>" + escapar(ex.grupo ?? "-") + " - " + escapar(ex.padrao ?? "-") + "</div></div>" +
          "<div class='plus'>" + (dentro ? "\u2713" : "+") + "</div></button>";
      }).join("")
    : "<p class='vazio'>Nenhum exercício com esse filtro.</p>";

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
    categoria: ex.categoria,
    metodo: "normal",
    descanso_s: 90,
    series: [novaSerie(), novaSerie(), novaSerie()],
  });
  desenharTreino();
  desenharLib();
}
const novaSerie = () => ({ carga_alvo: "", reps_alvo: "" });

function desenharTreino() {
  const alvo = $("#lista-ex");
  $("#vazio-treino").hidden = estado.treino.itens.length > 0;

  alvo.innerHTML = estado.treino.itens.map((item, i) => {
    const eTempo = item.categoria === "tempo";
    const linhas = item.series.map((s, j) =>
      "<tr><td class='sn'>" + (j + 1) + "</td>" +
      "<td><input value='" + escapar(s.carga_alvo) + "' placeholder='-' inputmode='decimal' data-campo='carga_alvo' data-i='" + i + "' data-j='" + j + "'></td>" +
      "<td><input value='" + escapar(s.reps_alvo) + "' placeholder='-' inputmode='numeric' data-campo='reps_alvo' data-i='" + i + "' data-j='" + j + "'></td>" +
      "<td><button class='rm' data-rmserie='" + i + ":" + j + "' title='Remover série'>×</button></td></tr>"
    ).join("");

    return "<div class='exblock'><div class='exhd'>" +
      "<button class='mover' data-subir='" + i + "' title='Subir'" + (i === 0 ? " disabled" : "") + ">↑</button>" +
      "<button class='mover' data-descer='" + i + "' title='Descer'" + (i === estado.treino.itens.length - 1 ? " disabled" : "") + ">↓</button>" +
      "<span class='nm'>" + escapar(item.nome) + "</span>" +
      "<select data-metodo='" + i + "'>" +
      METODOS.map((m) => "<option" + (item.metodo === m ? " selected" : "") + ">" + m + "</option>").join("") +
      "</select><button class='del' data-rmex='" + i + "' title='Remover exercício'>×</button></div>" +
      "<div class='exbd'><table class='setgrid'><thead><tr><th style='width:34px'>#</th><th>" +
      (eTempo ? "Intensidade" : "Carga (kg)") + "</th><th>" + (eTempo ? "Tempo (min)" : "Reps") +
      "</th><th style='width:34px'></th></tr></thead><tbody>" + linhas + "</tbody></table>" +
      "<button class='btn ghost sm' data-addserie='" + i + "' style='margin-top:8px'>+ Série</button>" +
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
  $$("[data-descanso]").forEach((inp) =>
    inp.addEventListener("input", () => {
      estado.treino.itens[+inp.dataset.descanso].descanso_s = inp.value;
      calcularResumoTreino();
    }));
  $$("[data-addserie]").forEach((b) =>
    b.addEventListener("click", () => {
      const it = estado.treino.itens[+b.dataset.addserie];
      const ult = it.series[it.series.length - 1];
      it.series.push({ carga_alvo: ult?.carga_alvo ?? "", reps_alvo: ult?.reps_alvo ?? "" });
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

  calcularResumoTreino();
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
    series += it.series.length;
    seg += it.series.length * ((parseInt(it.descanso_s) || 0) + 45);
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
    estrutura: estado.treino.itens,
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
  estado.treino = { id: null, nome: "", itens: [] };
  $("#in-nome-treino").value = "";
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
  };
  $("#in-nome-treino").value = r.data.nome;
  $("#sel-aluno").value = r.data.aluno_id;
  irPara("prescrever");
  desenharTreino();
  desenharLib();
}

$("#btn-rascunho").addEventListener("click", () => salvarTreino("rascunho"));
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
      (ex.video_url
        ? "<video src='" + escapar(ex.video_url) + "' controls preload='metadata' playsinline></video>"
        : "<div class='semvid'>sem vídeo</div>") +
      (ex.owner_id ? "<span class='tag-meu'>meu</span>" : "") +
      "</div><div class='info'><b>" + escapar(ex.nome) + "</b><div class='mini'>" +
      escapar(ex.grupo ?? "-") + " - " + escapar(ex.padrao ?? "-") + " - " + escapar(ex.categoria) +
      "</div></div><div class='acoes-ex'>" +
      "<button class='btn ghost sm' data-video='" + ex.id + "'>" + (ex.video_url ? "Trocar vídeo" : "Enviar vídeo") + "</button>" +
      (ex.owner_id ? "<button class='btn perigo sm' data-apagar='" + ex.id + "'>Apagar</button>" : "") +
      "</div></div>").join("")
    : "<p class='vazio'>Nenhum exercício com esse filtro.</p>";

  $$("[data-video]").forEach((b) =>
    b.addEventListener("click", () => enviarVideo(b.dataset.video)));
  $$("[data-apagar]").forEach((b) =>
    b.addEventListener("click", () => apagarExercicio(b.dataset.apagar)));
}

$("#btn-novo-ex").addEventListener("click", () => {
  abrirModal(
    "<h3>Novo exercício</h3><p class='desc'>Fica só na sua biblioteca — nenhum outro treinador vê.</p>" +
    "<form id='form-ex'><label class='campo'><span>Nome *</span><input id='e-nome' required></label>" +
    "<div class='linha'><label class='campo'><span>Grupo muscular</span><select id='e-grupo'>" +
    GRUPOS.filter((g) => g !== "Todos").map((g) => "<option>" + g + "</option>").join("") +
    "</select></label><label class='campo'><span>Padrão de movimento</span><select id='e-padrao'>" +
    PADROES.filter((p) => p !== "Todos").map((p) => "<option>" + p + "</option>").join("") +
    "</select></label></div>" +
    "<label class='campo'><span>Tipo</span><select id='e-categoria'>" +
    "<option value='forca'>Força (carga × repetições)</option>" +
    "<option value='tempo'>Tempo / cardio (duração)</option></select></label>" +
    "<label class='campo'><span>Observação técnica</span><textarea id='e-obs' rows='2' placeholder='Pontos de atenção na execução'></textarea></label>" +
    "<div id='e-erro' class='erro' hidden></div>" +
    "<div class='acoes'><button type='button' class='btn ghost' id='e-cancelar'>Cancelar</button>" +
    "<button type='submit' class='btn' id='e-salvar'>Criar exercício</button></div></form>");
  $("#e-cancelar").addEventListener("click", fecharModal);
  $("#form-ex").addEventListener("submit", criarExercicio);
});

async function criarExercicio(e) {
  e.preventDefault();
  const btn = $("#e-salvar");
  btn.disabled = true;
  btn.textContent = "Criando...";

  const r = await comTratamento(
    sb.from("exercises").insert({
      owner_id: estado.usuario.id,
      nome: $("#e-nome").value.trim(),
      grupo: $("#e-grupo").value,
      padrao: $("#e-padrao").value,
      categoria: $("#e-categoria").value,
      obs: $("#e-obs").value.trim() || null,
    }).select().single(),
    "Não consegui criar o exercício");

  btn.disabled = false;
  btn.textContent = "Criar exercício";
  if (!r.ok) return;

  fecharModal();
  await carregarExercicios();
  desenharBiblioteca();
  bom(r.data.nome + " criado");
}

async function apagarExercicio(id) {
  const ex = estado.exercicios.find((e) => e.id === id);
  abrirModal(
    "<h3>Apagar exercício?</h3><p class='desc'>" + escapar(ex?.nome ?? "") +
    " sai da sua biblioteca. Treinos já prescritos não mudam.</p>" +
    "<div class='acoes'><button class='btn ghost' id='x-nao'>Cancelar</button>" +
    "<button class='btn perigo' id='x-sim'>Apagar</button></div>");
  $("#x-nao").addEventListener("click", fecharModal);
  $("#x-sim").addEventListener("click", async () => {
    const r = await comTratamento(
      sb.from("exercises").delete().eq("id", id),
      "Não consegui apagar");
    fecharModal();
    if (!r.ok) return;
    await carregarExercicios();
    desenharBiblioteca();
    bom("Exercício apagado");
  });
}

function enviarVideo(exId) {
  const ex = estado.exercicios.find((e) => e.id === exId);
  abrirModal(
    "<h3>Video de " + escapar(ex?.nome ?? "") + "</h3>" +
    "<p class='desc'>Até " + MAX_VIDEO_MB + " MB, em MP4, MOV ou WEBM. O vídeo vai para o Storage — no banco fica só o endereço dele.</p>" +
    "<label class='campo'><span>Arquivo</span><input type='file' id='v-arquivo' accept='video/mp4,video/quicktime,video/webm'></label>" +
    "<div id='v-erro' class='erro' hidden></div>" +
    "<div id='v-prog' hidden><div class='mini' id='v-status'>Enviando...</div><div class='barra-prog'><i id='v-barra'></i></div></div>" +
    "<div class='acoes'><button class='btn ghost' id='v-cancelar'>Cancelar</button>" +
    "<button class='btn' id='v-enviar'>Enviar vídeo</button></div>");

  $("#v-cancelar").addEventListener("click", fecharModal);
  $("#v-enviar").addEventListener("click", () => executarUpload(exId));
}

async function executarUpload(exId) {
  const arquivo = $("#v-arquivo").files?.[0];
  const cErro = $("#v-erro");
  const btn = $("#v-enviar");
  cErro.hidden = true;

  if (!arquivo) { cErro.textContent = "Escolha um arquivo."; cErro.hidden = false; return; }

  const mb = arquivo.size / 1048576;
  if (mb > MAX_VIDEO_MB) {
    cErro.innerHTML = "Esse vídeo tem " + mb.toFixed(0) + " MB e o limite e " + MAX_VIDEO_MB + " MB.<br>" +
      "Grave em resolução menor (720p já basta para demonstração) ou corte o trecho essencial.";
    cErro.hidden = false;
    return;
  }
  if (!/^video\/(mp4|quicktime|webm)$/.test(arquivo.type)) {
    cErro.textContent = "Formato não aceito. Use MP4, MOV ou WEBM.";
    cErro.hidden = false;
    return;
  }

  btn.disabled = true;
  $("#v-prog").hidden = false;
  $("#v-barra").style.width = "15%";
  $("#v-status").textContent = "Enviando " + mb.toFixed(1) + " MB...";

  const ext = (arquivo.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const caminho = estado.usuario.id + "/" + crypto.randomUUID() + "." + ext;

  const up = await comTratamento(
    sb.storage.from("exercise-videos").upload(caminho, arquivo, {
      contentType: arquivo.type, upsert: false,
    }),
    "Falha no envio do vídeo");

  if (!up.ok) { btn.disabled = false; $("#v-prog").hidden = true; return; }

  $("#v-barra").style.width = "70%";
  $("#v-status").textContent = "Registrando...";

  const { data: pub } = sb.storage.from("exercise-videos").getPublicUrl(caminho);
  const url = pub.publicUrl;

  const r = await comTratamento(
    sb.from("exercises").update({ video_url: url }).eq("id", exId).select().single(),
    "O vídeo subiu, mas não consegui ligá-lo ao exercício");

  if (!r.ok) {
    await sb.storage.from("exercise-videos").remove([caminho]);
    btn.disabled = false;
    $("#v-prog").hidden = true;
    return;
  }

  $("#v-barra").style.width = "100%";
  fecharModal();
  await carregarExercicios();
  desenharBiblioteca();
  await carregarResumo();
  bom("Vídeo publicado");
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
