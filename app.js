/**
 * ═══════════════════════════════════════════════════
 * CULTURA VIVA — app.js
 * Lógica principal: carregamento, filtros, cards e modal
 * ═══════════════════════════════════════════════════
 *
 * ESTRUTURA DO JSON (pontosDecultura-corrigido.json):
 * {
 *   metadata: { total, estados[], municipiosPorEstado{}, areas[] },
 *   pontos: [
 *     { id, nome, entidade, areas[], publicos[], acoes[], estado, municipio, endereco, coordenadas: { lat, lng } }
 *   ]
 * }
 * ═══════════════════════════════════════════════════
 */

// ─── Configurações ────────────────────────────────
const CONFIG = {
  dataUrl:   'pontosDecultura-corrigido.json',
  porPagina:  12,   // cards por página
  debounce:   280,  // ms de espera no campo de busca
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  overpassRaioKm: 20,
};

// Paleta de listras dos cards (ciclada por inicial do estado)
const STRIPE_CORES = [
  '#1a3a2a', '#2d5c3f', '#4a8c5c', '#e8621a',
  '#8b4513', '#5b7fa6', '#7a5c3d', '#3d6b8a',
];

// ─── Estado da aplicação ──────────────────────────
let _dados           = null;  // dados carregados do JSON
let _filtrados       = [];    // resultado atual após todos os filtros
let _paginaAtual     = 1;
let map              = null;
let markersLayer     = null;
let selectedMarker   = null;
let _overpassLoading = false;

// Localização do usuário — { lat, lng } ou null se não obtida / negada
let _userLocation    = null;
let _filtrarPorRaio  = false;

// ─── Elementos do DOM ─────────────────────────────
const elGrid       = document.getElementById('cards-grid');
const elPaginacao  = document.getElementById('paginacao');
const elCount      = document.getElementById('resultado-count');
const elEstado     = document.getElementById('filtro-estado');
const elMunicipio  = document.getElementById('filtro-municipio');
const elArea       = document.getElementById('filtro-area');
const elRaio            = document.getElementById('filtro-raio');
const elRaioValor       = document.getElementById('raio-valor');
const elFiltroLocalizacao = document.getElementById('filtro-localizacao');
const elBusca           = document.getElementById('busca');
const elBtnLimpar       = document.getElementById('btn-limpar');
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
    aplicarFiltros();      // exibe todos os pontos enquanto aguarda geoloc
    configurarEventos();
    initMap();             // solicita geolocalização em paralelo

  } catch (err) {
    elGrid.innerHTML = `
      <div class="sem-resultados">
        <strong>Erro ao carregar dados.</strong><br>
        Verifique se o arquivo <code>pontosDecultura-corrigido.json</code>
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

  elEstado.innerHTML = '<option value="">Todos os estados</option>' +
    estados.map(e => `<option value="${e}">${e}</option>`).join('');

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
//  3. HAVERSINE — distância entre dois pontos (km)
// ════════════════════════════════════════════════════

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ════════════════════════════════════════════════════
//  4. FILTROS — única fonte da verdade
// ════════════════════════════════════════════════════

/**
 * aplicarFiltros() é chamada sempre que qualquer controle muda.
 * Quando a localização do usuário está disponível (_userLocation != null),
 * o filtro de raio é aplicado em conjunto com os demais filtros
 * (estado, município, área e busca textual).
 */
function aplicarFiltros() {
  const estado    = elEstado.value;
  const municipio = elMunicipio.value;
  const area      = elArea.value;
  const busca     = elBusca.value.toLowerCase().trim();
  const raioKm    = Number(elRaio.value) || 5;

  _filtrados = _dados.pontos.filter(p => {
    // ── Filtros de texto / seleção ──────────────────
    if (estado    && p.estado    !== estado)                       return false;
    if (municipio && p.municipio !== municipio)                    return false;
    if (area      && !p.areas.some(a => a === area))               return false;
    if (busca     && !p.nome.toLowerCase().includes(busca)
                  && !p.entidade.toLowerCase().includes(busca))    return false;

    // ── Filtro de raio (só quando localização disponível) ──
    if (_userLocation && _filtrarPorRaio) {
      if (!p.coordenadas || !p.coordenadas.lat || !p.coordenadas.lng) return false;
      const dist = haversine(
        _userLocation.lat, _userLocation.lng,
        p.coordenadas.lat, p.coordenadas.lng
      );
      if (dist > raioKm) return false;
    }

    return true;
  });

  _paginaAtual = 1;
  renderizarCards();
  renderizarMarcadores();
  atualizarContador();
}

// ════════════════════════════════════════════════════
//  5. RENDERIZAÇÃO DE CARDS
// ════════════════════════════════════════════════════

function renderizarCards() {
  const inicio = (_paginaAtual - 1) * CONFIG.porPagina;
  const pagina = _filtrados.slice(inicio, inicio + CONFIG.porPagina);

  if (_filtrados.length === 0) {
    const raioKm = Number(elRaio.value) || 5;
    const dica = _userLocation
      ? `Nenhum resultado em ${raioKm} km. Tente aumentar o raio ou limpar os filtros.`
      : 'Nenhum resultado para os filtros selecionados. Tente ampliar a busca.';
    elGrid.innerHTML = `<div class="sem-resultados">${dica}</div>`;
    elPaginacao.innerHTML = '';
    return;
  }

  elGrid.innerHTML = pagina.map((p, i) => criarCard(p, i)).join('');
  renderizarPaginacao();

  elGrid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => abrirModal(Number(el.dataset.id)));
  });

  elGrid.querySelectorAll('.btn-ver-mapa').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const card = e.currentTarget.closest('.card');
      const lat  = Number(card.dataset.lat);
      const lng  = Number(card.dataset.lng);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) focarNoMapa(lat, lng);
    });
  });
}

function criarCard(ponto, indice) {
  const corStripe = ponto.fonteOSM
    ? '#9d4edd'
    : STRIPE_CORES[ponto.estado ? ponto.estado.charCodeAt(0) : 0 % STRIPE_CORES.length];

  const areasHtml = ponto.areas.length
    ? ponto.areas.slice(0, 3).map(a => `<span class="tag">${a}</span>`).join('') +
      (ponto.areas.length > 3 ? `<span class="tag tag--laranja">+${ponto.areas.length - 3}</span>` : '')
    : '<span class="tag" style="opacity:.5">Não informado</span>';

  const fonteHtml = ponto.fonte === 'OpenStreetMap'
    ? `<span class="tag tag--osm">Fonte: OpenStreetMap</span>`
    : '';

  const publicoCount = ponto.publicos.length
    ? `${ponto.publicos.length} público${ponto.publicos.length > 1 ? 's' : ''}`
    : '';

  // Badge de distância — só aparece com localização disponível
  let distBadge = '';
  if (_userLocation && ponto.coordenadas && ponto.coordenadas.lat && ponto.coordenadas.lng) {
    const km = haversine(
      _userLocation.lat, _userLocation.lng,
      ponto.coordenadas.lat, ponto.coordenadas.lng
    );
    distBadge = `<span class="card__dist">${km < 1 ? (km * 1000).toFixed(0) + ' m' : km.toFixed(1) + ' km'}</span>`;
  }

  const temCoord = ponto.coordenadas && ponto.coordenadas.lat && ponto.coordenadas.lng;

  return `
    <article
      class="card"
      data-id="${ponto.id}"
      data-lat="${ponto.coordenadas ? ponto.coordenadas.lat : ''}"
      data-lng="${ponto.coordenadas ? ponto.coordenadas.lng : ''}"
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
          ${distBadge}
        </div>
        <h3 class="card__nome">${ponto.nome}</h3>
        ${ponto.entidade && ponto.entidade !== ponto.nome
          ? `<p class="card__entidade">${ponto.entidade}</p>`
          : ''}
        <div class="card__areas">${areasHtml}${fonteHtml}</div>
      </div>
      <div class="card__footer">
        <span class="card__publico-count">${publicoCount}</span>
        <span class="card__ver-mais">Ver detalhes →</span>
        ${temCoord ? '<button class="btn-ver-mapa" type="button">Ver no mapa</button>' : ''}
      </div>
    </article>
  `;
}

// ════════════════════════════════════════════════════
//  6. MARCADORES NO MAPA
// ════════════════════════════════════════════════════

function renderizarMarcadores() {
  if (!map || !markersLayer) return;

  markersLayer.clearLayers();

  const pontosComCoord = _filtrados.filter(
    p => p.coordenadas && p.coordenadas.lat && p.coordenadas.lng
  );

  if (!pontosComCoord.length) return;

  const bounds = L.latLngBounds();

  pontosComCoord.forEach(ponto => {
    const { lat, lng } = ponto.coordenadas;
    bounds.extend([lat, lng]);

    const areaPrincipal = ponto.areas[0] || 'Cultura';
    const marker = L.marker([lat, lng], { icon: createMarkerIcon(areaPrincipal) });

    // Distância no popup (só com localização disponível)
    let distInfo = '';
    if (_userLocation) {
      const km = haversine(_userLocation.lat, _userLocation.lng, lat, lng);
      distInfo = `<br><small>📍 ${km < 1 ? (km * 1000).toFixed(0) + ' m' : km.toFixed(1) + ' km'} de você</small>`;
    }

    marker.bindPopup(`
      <div style="max-width:200px">
        <strong>${ponto.nome}</strong><br>
        <em>${ponto.entidade}</em><br>
        <small>${ponto.municipio} · ${ponto.estado}</small>
        ${distInfo}
        <div style="margin-top:5px">
          ${ponto.areas.slice(0, 2).map(a =>
            `<span style="background:#f0f0f0;padding:2px 6px;border-radius:3px;font-size:11px;margin-right:2px">${a}</span>`
          ).join('')}
          ${ponto.areas.length > 2 ? `<span style="font-size:11px;color:#666">+${ponto.areas.length - 2}</span>` : ''}
        </div>
      </div>`
    );

    marker.addTo(markersLayer);
  });

  // Ajusta o mapa para mostrar todos os pontos filtrados
  // (exceto quando o usuário acabou de focar em um ponto específico)
  if (pontosComCoord.length > 0 && !map._focusedMarker) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

// ════════════════════════════════════════════════════
//  7. PAGINAÇÃO
// ════════════════════════════════════════════════════

function renderizarPaginacao() {
  const total = Math.ceil(_filtrados.length / CONFIG.porPagina);
  if (total <= 1) { elPaginacao.innerHTML = ''; return; }

  const p = _paginaAtual;
  let html = '';
  html += `<button class="pag-btn" onclick="irParaPagina(${p - 1})" ${p === 1 ? 'disabled' : ''}>‹</button>`;

  calcularPaginas(p, total).forEach(item => {
    if (item === '...') {
      html += `<span class="pag-ellipsis">…</span>`;
    } else {
      html += `<button class="pag-btn ${item === p ? 'pag-btn--ativo' : ''}" onclick="irParaPagina(${item})">${item}</button>`;
    }
  });

  html += `<button class="pag-btn" onclick="irParaPagina(${p + 1})" ${p === total ? 'disabled' : ''}>›</button>`;
  elPaginacao.innerHTML = html;
}

function calcularPaginas(atual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (atual > 3) pages.push('...');
  for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) pages.push(i);
  if (atual < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

function irParaPagina(p) {
  const total = Math.ceil(_filtrados.length / CONFIG.porPagina);
  if (p < 1 || p > total) return;
  _paginaAtual = p;
  renderizarCards();
  document.getElementById('explorar').scrollIntoView({ behavior: 'smooth' });
}

window.irParaPagina = irParaPagina;

// ════════════════════════════════════════════════════
//  8. CONTADOR DE RESULTADOS
// ════════════════════════════════════════════════════

function atualizarContador() {
  if (_overpassLoading) {
    elCount.innerHTML = 'Buscando locais adicionais em tempo real...';
    return;
  }

  const n      = _filtrados.length;
  const raioKm = Number(elRaio.value) || 5;

  if (n === 0) {
    elCount.innerHTML = _userLocation
      ? _filtrarPorRaio
        ? `Nenhum ponto encontrado em ${raioKm} km`
        : 'Nenhum resultado encontrado dentro do filtro atual'
      : 'Nenhum resultado encontrado';
    return;
  }

  let sufixo = '';
  if (_userLocation) {
    sufixo = _filtrarPorRaio
      ? ` &mdash; dentro de <strong>${raioKm} km</strong>`
      : ' &mdash; localização disponível, filtro desligado';
  }

  elCount.innerHTML =
    `<strong>${n.toLocaleString('pt-BR')}</strong> ponto${n !== 1 ? 's' : ''} encontrado${n !== 1 ? 's' : ''}${sufixo}`;
}

// ════════════════════════════════════════════════════
//  9. MODAL DE DETALHES
// ════════════════════════════════════════════════════

function abrirModal(id) {
  const ponto = _dados.pontos.find(p => p.id === id);
  if (!ponto) return;

  const corStripe    = STRIPE_CORES[ponto.estado.charCodeAt(0) % STRIPE_CORES.length];
  const areasHtml    = ponto.areas.length
    ? ponto.areas.map(a => `<span class="tag">${a}</span>`).join('')
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';
  const publicosHtml = ponto.publicos.length
    ? `<ul class="modal-lista">${ponto.publicos.map(p => `<li>${p}</li>`).join('')}</ul>`
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';
  const acoesHtml    = ponto.acoes.length
    ? `<ul class="modal-lista">${ponto.acoes.map(a => `<li>${a}</li>`).join('')}</ul>`
    : '<em style="opacity:.5;font-size:.85rem">Não informado</em>';

  let distHtml = '';
  if (_userLocation && ponto.coordenadas && ponto.coordenadas.lat && ponto.coordenadas.lng) {
    const km = haversine(
      _userLocation.lat, _userLocation.lng,
      ponto.coordenadas.lat, ponto.coordenadas.lng
    );
    distHtml = `<p class="modal-local" style="color:#22c55e;font-weight:600">📍 ${km < 1 ? (km * 1000).toFixed(0) + ' m' : km.toFixed(1) + ' km'} de você</p>`;
  }

  elModalBody.innerHTML = `
    <div class="modal-stripe" style="background:${corStripe}"></div>
    <p class="modal-local">${ponto.municipio || '—'} · ${ponto.estado}</p>
    ${distHtml}
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
//  10. EVENTOS
// ════════════════════════════════════════════════════

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function configurarEventos() {
  elEstado.addEventListener('change', () => { popularMunicipios(elEstado.value); aplicarFiltros(); });
  elMunicipio.addEventListener('change', aplicarFiltros);
  elArea.addEventListener('change', aplicarFiltros);
  elBusca.addEventListener('input', debounce(aplicarFiltros, CONFIG.debounce));
  elBusca.addEventListener('keydown', e => { if (e.key === 'Enter') aplicarFiltros(); });

  // Slider de raio — atualiza label, círculo no mapa e refiltros
  elFiltroLocalizacao.addEventListener('change', e => {
    _filtrarPorRaio = e.target.checked;
    aplicarFiltros();
  });

  elRaio.addEventListener('input', e => {
    const valor = Number(e.target.value);
    elRaioValor.textContent = valor;
    if (window._userCircle) window._userCircle.setRadius(valor * 1000);
    aplicarFiltros();
  });

  // Limpar filtros
  elBtnLimpar.addEventListener('click', () => {
    elEstado.value             = '';
    elMunicipio.value          = '';
    elArea.value               = '';
    elBusca.value              = '';
    elRaio.value               = '5';
    elRaioValor.textContent    = '5';
    _filtrarPorRaio            = false;
    elFiltroLocalizacao.checked = false;
    if (window._userCircle) window._userCircle.setRadius(5000);
    popularMunicipios('');
    aplicarFiltros();
  });

  // Modal
  elModalClose.addEventListener('click', fecharModal);
  elModal.addEventListener('click', e => { if (e.target === elModal) fecharModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

  // Acessibilidade: Enter nos cards
  elGrid.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) {
      abrirModal(Number(e.target.dataset.id));
    }
  });
}

// ════════════════════════════════════════════════════
//  11. MAPA (Leaflet)
// ════════════════════════════════════════════════════

function initMap() {
  if (typeof L === 'undefined' || !document.getElementById('mapa-container')) return;

  if (typeof L.markerClusterGroup === 'function') {
    markersLayer = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      removeOutsideVisibleBounds: true,
      maxClusterRadius: 50,
    });
  } else {
    console.warn('[CulturaViva] Leaflet marker cluster não disponível. Usando layerGroup sem cluster.');
    markersLayer = L.layerGroup();
  }

  // Visão inicial: Brasil inteiro
  map = L.map('mapa-container', { zoomControl: true }).setView([-14.235, -51.925], 4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  markersLayer.addTo(map);
  if (typeof L.control === 'object' && typeof L.control.scale === 'function') {
    L.control.scale({ imperial: false, maxWidth: 130 }).addTo(map);
  }

  map.on('locationfound', onLocationFound);
  map.on('locationerror', onLocationError);

  updateLocationStatus('Solicitando sua localização…');
  map.locate({ setView: false, maxZoom: 15 });

  // Renderiza marcadores de todos os pontos enquanto aguarda geoloc
  renderizarMarcadores();

  setTimeout(() => map.invalidateSize(), 260);
}

function onLocationFound(e) {
  const { lat, lng } = e.latlng;
  const raioKm = Number(elRaio.value) || 5;

  // Marcador do usuário
  L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'user-location-marker',
      html: '<span></span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    }),
  }).addTo(map).bindPopup('📍 Você está aqui').openPopup();

  // Círculo de raio dinâmico
  window._userCircle = L.circle([lat, lng], {
    radius: raioKm * 1000,
    color: '#22c55e',
    fillColor: '#22c55e',
    fillOpacity: 0.18,
    weight: 3,
  }).addTo(map);

  // Centraliza no usuário
  map.setView([lat, lng], 13);

  // Salva localização e prepara o controle de filtro por raio
  _userLocation = { lat, lng };
  elFiltroLocalizacao.disabled = false;
  updateLocationStatus('Localização encontrada — ative o filtro para limitar por raio.');
  aplicarFiltros();
  buscarPontosOverpass(lat, lng);
}

function onLocationError() {
  elFiltroLocalizacao.disabled = true;
  _filtrarPorRaio = false;
  elFiltroLocalizacao.checked = false;
  updateLocationStatus('Localização não disponível. Mostrando todos os pontos.');
  aplicarFiltros();
}

function updateLocationStatus(msg) {
  if (elCount) elCount.textContent = msg;
}

async function buscarPontosOverpass(lat, lng) {
  if (!_dados || !_dados.pontos) return;

  _overpassLoading = true;
  updateLocationStatus('Buscando locais adicionais em tempo real...');

  const query = `[out:json][timeout:20];
    (
      node["amenity"="library"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      way["amenity"="library"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      relation["amenity"="library"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      node["amenity"="theatre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      way["amenity"="theatre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      relation["amenity"="theatre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      node["tourism"="museum"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      way["tourism"="museum"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      relation["tourism"="museum"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      node["leisure"="park"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      way["leisure"="park"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      relation["leisure"="park"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      node["amenity"="cultural_centre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      way["amenity"="cultural_centre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
      relation["amenity"="cultural_centre"](around:${CONFIG.overpassRaioKm * 1000},${lat},${lng});
    );
    out center tags;`;

  try {
    const res = await fetch(CONFIG.overpassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();
    const novosPontos = transformarOverpassEmPontos(data.elements || []);

    if (novosPontos.length) {
      _dados.pontos = [..._dados.pontos, ...novosPontos];
      aplicarFiltros();
    }
  } catch (err) {
    console.error('[CulturaViva] Overpass', err);
    updateLocationStatus('Não foi possível carregar dados em tempo real. Mostrando pontos locais.');
  } finally {
    _overpassLoading = false;
    atualizarContador();
  }
}

function transformarOverpassEmPontos(elements) {
  const mapTipoParaArea = {
    library: 'Biblioteca',
    theatre: 'Teatro',
    museum: 'Museu',
    park: 'Parque',
    cultural_centre: 'Centro Cultural',
  };

  return elements.reduce((acc, item) => {
    const tags = item.tags || {};
    const nome = tags.name || tags['name:pt'] || tags['name:en'] ||
      tags.amenity || tags.leisure || tags.tourism || 'Local cultural';

    const coords = item.lat && item.lon
      ? { lat: item.lat, lng: item.lon }
      : item.center
        ? { lat: item.center.lat, lng: item.center.lon }
        : null;

    if (!coords) return acc;

    const tipo = tags.amenity || tags.tourism || tags.leisure || '';
    const areaLabel = mapTipoParaArea[tipo] || 'Cultura';

    const existe = _dados.pontos.some(existing => {
      if (!existing.coordenadas || !existing.coordenadas.lat || !existing.coordenadas.lng) return false;
      const mesmaDistancia = haversine(
        existing.coordenadas.lat, existing.coordenadas.lng,
        coords.lat, coords.lng
      ) < 0.05;
      return existing.nome.toLowerCase() === nome.toLowerCase() || mesmaDistancia;
    });

    if (existe) return acc;

    const endereco = [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']]
      .filter(Boolean)
      .join(', ');

    acc.push({
      id: `osm-${item.type}-${item.id}`,
      nome,
      entidade: tags.operator || tags['contact:organization'] || nome,
      areas: [areaLabel],
      publicos: [],
      acoes: [],
      estado: tags['addr:state'] || '',
      municipio: tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || '',
      endereco: endereco || 'Endereço não informado',
      coordenadas: coords,
      fonte: 'OpenStreetMap',
      fonteOSM: true,
    });

    return acc;
  }, []);
}

function createMarkerIcon(area) {
  const coresPorArea = {
    'Artes Visuais':   '#4a8c5c',
    'Teatro':          '#e8621a',
    'Música':          '#5b7fa6',
    'Dança':           '#7a5c3d',
    'Literatura':      '#3d6b8a',
    'Artes Marciais':  '#8b4513',
    'Futebol':         '#e8621a',
    'Basquete':        '#2d5c3f',
    'Natação':         '#1a3a2a',
    'Outros Esportes': '#5b7fa6',
    'Cinema':          '#7a5c3d',
    'Fotografia':      '#4a8c5c',
    'Artesanato':      '#3d6b8a',
    'Cultura Popular': '#8b4513',
    'Educação':        '#2d5c3f',
  };
  const color = coresPorArea[area] || '#5b7fa6';
  return L.divIcon({
    className: 'custom-leaflet-marker',
    html: `<span class="marker-pin" style="background:${color}"></span>`,
    iconSize: [28, 34],
    iconAnchor: [14, 34],
    popupAnchor: [0, -34],
  });
}

function createSelectedLocatorIcon() {
  return L.divIcon({
    className: 'selected-location-marker',
    html: '<span class="marker-pin"><span class="pulse"></span></span>',
    iconSize: [40, 46],
    iconAnchor: [20, 46],
    popupAnchor: [0, -44],
  });
}

function focarNoMapa(lat, lng) {
  if (!map) return;
  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }

  selectedMarker = L.marker([lat, lng], {
    icon: createSelectedLocatorIcon(),
    zIndexOffset: 1000,
  }).addTo(map);

  map._focusedMarker = true;
  map.flyTo([lat, lng], 17);
  markersLayer.eachLayer(layer => {
    if (layer instanceof L.Marker) {
      const ll = layer.getLatLng();
      if (Math.abs(ll.lat - lat) < 0.0001 && Math.abs(ll.lng - lng) < 0.0001) {
        layer.openPopup();
      }
    }
  });

  // remove o destaque antigo depois de um tempo
  setTimeout(() => {
    if (selectedMarker) {
      map.removeLayer(selectedMarker);
      selectedMarker = null;
    }
    map._focusedMarker = false;
  }, 5000);
}

// ─── Inicia a aplicação ───────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ════════════════════════════════════════════════════
//  12. PONTE DE INTEGRAÇÃO COM IA
// ════════════════════════════════════════════════════

function integrarIAComDadosReais() {
  const humorUsuario = document.getElementById('usuario-humor')?.value;
  const municipio    = elMunicipio ? elMunicipio.value : 'sua região';

  if (typeof gerarRecomendacaoCultural === 'function') {
    if (!humorUsuario) {
      alert('Por favor, descreva como você se sente no campo da IA!');
      return;
    }
    gerarRecomendacaoCultural(humorUsuario, municipio, _filtrados);
  } else {
    console.error('Erro: A função gerarRecomendacaoCultural não foi encontrada.');
  }
}
