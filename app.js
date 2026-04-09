/**
 * ═══════════════════════════════════════════════════
 *  CULTURA VIVA — app.js
 *  Lógica principal: carregamento, filtros, cards e modal
 * ═══════════════════════════════════════════════════
 *
 *  ESTRUTURA DO JSON (pontosDecultura.json):
 *  {
 *    metadata: { total, estados[], municipiosPorEstado{}, areas[] },
 *    pontos: [
 *      { id, nome, entidade, areas[], publicos[], acoes[], estado, municipio, endereco }
 *    ]
 *  }
 * ═══════════════════════════════════════════════════
 */

// ─── Configurações ────────────────────────────────
const CONFIG = {
  dataUrl:    'pontosDecultura.json',
  porPagina:  12,           // cards por página
  debounce:   280,          // ms de espera no campo de busca
};

// Paleta de listras dos cards (ciclada por inicial do estado)
const STRIPE_CORES = [
  '#1a3a2a', '#2d5c3f', '#4a8c5c', '#e8621a',
  '#8b4513', '#5b7fa6', '#7a5c3d', '#3d6b8a',
];

// ─── Estado da aplicação ──────────────────────────
let _dados        = null;   // dados carregados do JSON
let _filtrados    = [];     // resultado atual após filtros
let _paginaAtual  = 1;

// ─── Elementos do DOM ─────────────────────────────
const elGrid       = document.getElementById('cards-grid');
const elPaginacao  = document.getElementById('paginacao');
const elCount      = document.getElementById('resultado-count');
const elEstado     = document.getElementById('filtro-estado');
const elMunicipio  = document.getElementById('filtro-municipio');
const elArea       = document.getElementById('filtro-area');
const elBusca      = document.getElementById('busca');
const elBtnLimpar  = document.getElementById('btn-limpar');
const elModal      = document.getElementById('modal-overlay');
const elModalBody  = document.getElementById('modal-body');
const elModalClose = document.getElementById('modal-close');
const elStatMun    = document.getElementById('stat-municipios');

// ════════════════════════════════════════════════════
//  1. INICIALIZAÇÃO
// ════════════════════════════════════════════════════

async function init() {
  try {
    const res = await fetch(CONFIG.dataUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _dados = await res.json();

    popularSelects();
    atualizarStats();
    aplicarFiltros();
    configurarEventos();

  } catch (err) {
    elGrid.innerHTML = `
      <div class="sem-resultados">
        <strong>Erro ao carregar dados.</strong><br>
        Verifique se o arquivo <code>pontosDecultura.json</code>
        está na mesma pasta que o <code>index.html</code>.
        <br><small style="margin-top:8px;display:block;opacity:.6">${err.message}</small>
      </div>`;
    console.error('[CulturaViva]', err);
  }
}

// ════════════════════════════════════════════════════
//  2. POPULAR SELECTS
// ════════════════════════════════════════════════════

function popularSelects() {
  const { estados, areas } = _dados.metadata;

  // Select de estados
  elEstado.innerHTML = '<option value="">Todos os estados</option>' +
    estados.map(e => `<option value="${e}">${e}</option>`).join('');

  // Select de áreas
  elArea.innerHTML = '<option value="">Todas as áreas</option>' +
    areas.map(a => `<option value="${a}">${a}</option>`).join('');
}

function popularMunicipios(estado) {
  if (!estado) {
    elMunicipio.innerHTML = '<option value="">Selecione um estado primeiro</option>';
    elMunicipio.disabled = true;
    return;
  }

  const muns = _dados.metadata.municipiosPorEstado[estado] || [];
  elMunicipio.innerHTML = `<option value="">Todos os municípios</option>` +
    muns.map(m => `<option value="${m}">${m}</option>`).join('');
  elMunicipio.disabled = false;
}

function atualizarStats() {
  const totalMunicipios = Object.values(_dados.metadata.municipiosPorEstado)
    .reduce((acc, arr) => acc + arr.length, 0);
  if (elStatMun) elStatMun.textContent = totalMunicipios.toLocaleString('pt-BR');
}

// ════════════════════════════════════════════════════
//  3. FILTROS
// ════════════════════════════════════════════════════

function aplicarFiltros() {
  const estado   = elEstado.value;
  const municipio = elMunicipio.value;
  const area     = elArea.value;
  const busca    = elBusca.value.toLowerCase().trim();

  _filtrados = _dados.pontos.filter(p => {
    if (estado    && p.estado    !== estado)                           return false;
    if (municipio && p.municipio !== municipio)                        return false;
    if (area      && !p.areas.some(a => a === area))                   return false;
    if (busca     && !p.nome.toLowerCase().includes(busca)
                  && !p.entidade.toLowerCase().includes(busca))        return false;
    return true;
  });

  _paginaAtual = 1;
  renderizarPagina();
  atualizarContador();
}

// ════════════════════════════════════════════════════
//  4. RENDERIZAÇÃO DE CARDS
// ════════════════════════════════════════════════════

function renderizarPagina() {
  const inicio  = (_paginaAtual - 1) * CONFIG.porPagina;
  const pagina  = _filtrados.slice(inicio, inicio + CONFIG.porPagina);

  if (_filtrados.length === 0) {
    elGrid.innerHTML = `
      <div class="sem-resultados">
        Nenhum resultado encontrado para os filtros selecionados.<br>
        <strong>Tente ampliar a busca.</strong>
      </div>`;
    elPaginacao.innerHTML = '';
    return;
  }

  elGrid.innerHTML = pagina.map((p, i) => criarCard(p, i)).join('');
  renderizarPaginacao();

  // Adiciona listeners de clique nos cards
  elGrid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => abrirModal(Number(el.dataset.id)));
  });

  // Rola suavemente para o topo da listagem
  elGrid.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function criarCard(ponto, indice) {
  const corStripe = STRIPE_CORES[ponto.estado.charCodeAt(0) % STRIPE_CORES.length];

  const areasHtml = ponto.areas.length
    ? ponto.areas.slice(0, 3).map(a => `<span class="tag">${a}</span>`).join('') +
      (ponto.areas.length > 3 ? `<span class="tag tag--laranja">+${ponto.areas.length - 3}</span>` : '')
    : '<span class="tag" style="opacity:.5">Não informado</span>';

  const publicoCount = ponto.publicos.length
    ? `${ponto.publicos.length} público${ponto.publicos.length > 1 ? 's' : ''}`
    : '';

  return `
    <article
      class="card"
      data-id="${ponto.id}"
      style="animation-delay:${indice * 40}ms"
      tabindex="0"
      role="button"
      aria-label="Ver detalhes de ${ponto.nome}"
    >
      <div class="card__stripe" style="background:${corStripe}"></div>

      <div class="card__body">
        <div class="card__local">
          <span class="card__local-dot"></span>
          ${ponto.municipio || '—'} · ${ponto.estado}
        </div>

        <h3 class="card__nome">${ponto.nome}</h3>

        ${ponto.entidade && ponto.entidade !== ponto.nome
          ? `<p class="card__entidade">${ponto.entidade}</p>`
          : ''}

        <div class="card__areas">${areasHtml}</div>
      </div>

      <div class="card__footer">
        <span class="card__publico-count">${publicoCount}</span>
        <span class="card__ver-mais">Ver detalhes →</span>
      </div>
    </article>
  `;
}

// ════════════════════════════════════════════════════
//  5. PAGINAÇÃO
// ════════════════════════════════════════════════════

function renderizarPaginacao() {
  const total = Math.ceil(_filtrados.length / CONFIG.porPagina);
  if (total <= 1) { elPaginacao.innerHTML = ''; return; }

  const p = _paginaAtual;
  let html = '';

  // Botão anterior
  html += `<button class="pag-btn" onclick="irParaPagina(${p - 1})" ${p === 1 ? 'disabled' : ''}>‹</button>`;

  // Páginas (com ellipsis)
  const pages = calcularPaginas(p, total);
  pages.forEach(item => {
    if (item === '...') {
      html += `<span class="pag-ellipsis">…</span>`;
    } else {
      html += `<button class="pag-btn ${item === p ? 'pag-btn--ativo' : ''}" onclick="irParaPagina(${item})">${item}</button>`;
    }
  });

  // Botão próximo
  html += `<button class="pag-btn" onclick="irParaPagina(${p + 1})" ${p === total ? 'disabled' : ''}>›</button>`;

  elPaginacao.innerHTML = html;
}

function calcularPaginas(atual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [1];
  if (atual > 3) pages.push('...');
  for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) {
    pages.push(i);
  }
  if (atual < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function irParaPagina(p) {
  const total = Math.ceil(_filtrados.length / CONFIG.porPagina);
  if (p < 1 || p > total) return;
  _paginaAtual = p;
  renderizarPagina();
  document.getElementById('explorar').scrollIntoView({ behavior: 'smooth' });
}

// Expõe globalmente para os onclick inline da paginação
window.irParaPagina = irParaPagina;

// ════════════════════════════════════════════════════
//  6. CONTADOR DE RESULTADOS
// ════════════════════════════════════════════════════

function atualizarContador() {
  const n = _filtrados.length;
  elCount.innerHTML = n === 0
    ? 'Nenhum resultado encontrado'
    : `<strong>${n.toLocaleString('pt-BR')}</strong> ponto${n !== 1 ? 's' : ''} de cultura encontrado${n !== 1 ? 's' : ''}`;
}

// ════════════════════════════════════════════════════
//  7. MODAL DE DETALHES
// ════════════════════════════════════════════════════

function abrirModal(id) {
  const ponto = _dados.pontos.find(p => p.id === id);
  if (!ponto) return;

  const corStripe = STRIPE_CORES[ponto.estado.charCodeAt(0) % STRIPE_CORES.length];

  const areasHtml = ponto.areas.length
    ? ponto.areas.map(a => `<span class="tag">${a}</span>`).join('')
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';

  const publicosHtml = ponto.publicos.length
    ? `<ul class="modal-lista">${ponto.publicos.map(p => `<li>${p}</li>`).join('')}</ul>`
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';

  const acoesHtml = ponto.acoes.length
    ? `<ul class="modal-lista">${ponto.acoes.map(a => `<li>${a}</li>`).join('')}</ul>`
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';

  elModalBody.innerHTML = `
    <div class="modal-stripe" style="background:${corStripe}"></div>

    <p class="modal-local">${ponto.municipio || '—'} · ${ponto.estado}</p>
    <h2 class="modal-nome" id="modal-nome">${ponto.nome}</h2>
    <p class="modal-entidade">${ponto.entidade || ''}</p>

    <div class="modal-secao">
      <p class="modal-secao__titulo">🎨 Áreas de experiência e temas</p>
      <div class="modal-tags">${areasHtml}</div>
    </div>

    <div class="modal-secao">
      <p class="modal-secao__titulo">👥 Públicos que participam</p>
      ${publicosHtml}
    </div>

    <div class="modal-secao">
      <p class="modal-secao__titulo">⚙️ Ações estruturantes</p>
      ${acoesHtml}
    </div>

    <div class="modal-secao">
      <p class="modal-secao__titulo">📍 Endereço</p>
      <p class="modal-endereco">${ponto.endereco || 'Endereço não informado'}</p>
    </div>
  `;

  elModal.classList.add('ativo');
  document.body.style.overflow = 'hidden';
}

function fecharModal() {
  elModal.classList.remove('ativo');
  document.body.style.overflow = '';
}

// ════════════════════════════════════════════════════
//  8. EVENTOS
// ════════════════════════════════════════════════════

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function configurarEventos() {
  // Filtro por estado → atualiza municípios
  elEstado.addEventListener('change', () => {
    popularMunicipios(elEstado.value);
    aplicarFiltros();
  });

  elMunicipio.addEventListener('change', aplicarFiltros);
  elArea.addEventListener('change', aplicarFiltros);
  elBusca.addEventListener('input', debounce(aplicarFiltros, CONFIG.debounce));

  // Tecla Enter no campo de busca
  elBusca.addEventListener('keydown', e => {
    if (e.key === 'Enter') aplicarFiltros();
  });

  // Limpar filtros
  elBtnLimpar.addEventListener('click', () => {
    elEstado.value    = '';
    elMunicipio.value = '';
    elArea.value      = '';
    elBusca.value     = '';
    popularMunicipios('');
    aplicarFiltros();
  });

  // Modal
  elModalClose.addEventListener('click', fecharModal);
  elModal.addEventListener('click', e => {
    if (e.target === elModal) fecharModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') fecharModal();
  });

  // Acessibilidade: Enter nos cards
  elGrid.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) {
      abrirModal(Number(e.target.dataset.id));
    }
  });
}

// ─── Inicia a aplicação ───────────────────────────
document.addEventListener('DOMContentLoaded', init);
