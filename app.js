const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbyYG1ytZkXTtDzNgELW3Q2hP8HfuRtmCmjAKAOnzkn14rs4HEqQ1STK3DA96zCHRjVEcQ/exec";
const DEFAULT_SCRIPT_URL = DEFAULT_GAS_URL;
const DEFAULT_GAS_VIEW_URL = "https://docs.google.com/spreadsheets/d/1ueYAzpCLsHeuKVy8KC-KfGINyzEqnn7KkHWxma9f-2I/edit?usp=sharing";

window.DEFAULT_GAS_URL = DEFAULT_GAS_URL;
window.DEFAULT_SCRIPT_URL = DEFAULT_SCRIPT_URL;
window.DEFAULT_GAS_VIEW_URL = DEFAULT_GAS_VIEW_URL;

// Funciones globales y blindadas de formateo numérico, monetario y de fechas
function formatNumber(val, decimals = 2) {
  try {
    if (val === null || val === undefined || val === "" || isNaN(Number(val))) return "0.00";
    return Number(val).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  } catch(e) {
    return String(val || "0");
  }
}

function formatUSD(num) {
  try {
    if (num === null || num === undefined || num === "" || isNaN(Number(num))) return "$0.00";
    return "$" + Number(num).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch(e) {
    return "$0.00";
  }
}

function formatVES(num) {
  try {
    if (num === null || num === undefined || num === "" || isNaN(Number(num))) return "Bs 0,00";
    return "Bs " + Number(num).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch(e) {
    return "Bs 0,00";
  }
}

function formatEUR(num) {
  try {
    if (num === null || num === undefined || num === "" || isNaN(Number(num))) return "€0,00";
    return "€" + Number(num).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch(e) {
    return "€0,00";
  }
}

function formatCurrency(val, currency = "USD") {
  try {
    const cur = String(currency || "USD").toUpperCase();
    if (cur === "VES" || cur === "BS") return formatVES(val);
    if (cur === "EUR") return formatEUR(val);
    return formatUSD(val);
  } catch(e) {
    return formatUSD(val);
  }
}

function formatDate(dateVal) {
  try {
    if (!dateVal) return "--";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" });
  } catch(e) {
    return String(dateVal || "--");
  }
}

function formatShortDate(dateVal) {
  try {
    if (!dateVal) return "--";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch(e) {
    return String(dateVal || "--");
  }
}

window.formatNumber = formatNumber;
window.formatUSD = formatUSD;
window.formatVES = formatVES;
window.formatEUR = formatEUR;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatShortDate = formatShortDate;

let appData = {
  config: {},
  proveedores: [],
  catalogo: [],
  escenarios_rows: [],
  invitados: [],
  tareas: []
};

let activeScenarioId = "ESC-01";
let saveTimeout = null;
let currentViewingProviderId = null;
let pendingDeleteAction = null;
let isDataLoaded = false;
window.isDataLoaded = false;
let retryCount = 0;
const MAX_AUTO_RETRIES = 12;
let cloudConfig = {
  google_sheets_url: DEFAULT_SCRIPT_URL,
  google_sheets_view_url: DEFAULT_GAS_VIEW_URL
};
window.cloudConfig = cloudConfig;
window.appData = appData;

// Sincronizar todos los datos de memoria con localStorage para persistencia instantánea y offline
function syncAppDataToLocalStorage() {
  try {
    if (appData.config) localStorage.setItem("cached_config", JSON.stringify(appData.config));
    if (appData.proveedores) localStorage.setItem("cached_proveedores", JSON.stringify(appData.proveedores));
    if (appData.catalogo) localStorage.setItem("cached_catalogo", JSON.stringify(appData.catalogo));
    if (appData.escenarios_rows) localStorage.setItem("cached_escenarios_rows", JSON.stringify(appData.escenarios_rows));
    if (appData.invitados) localStorage.setItem("cached_invitados", JSON.stringify(appData.invitados));
    if (appData.tareas) localStorage.setItem("cached_tareas", JSON.stringify(appData.tareas));
  } catch (e) {
    console.warn("[LocalStorage] Error sincronizando caché local:", e);
  }
}

// Normalizar y blindar cada objeto invitado para compatibilidad con las columnas exactas de Google Sheets
function normalizeGuest(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = String(raw.ID_Invitado || raw.id || raw.ID || "").trim();
  const nombre = String(raw.Nombre_Comp || raw.Nombre_Completo || raw.Nombre || raw.nombre || "").trim();

  // Teléfono: puede venir como number (ej. 4141234567), float, string o null/undefined
  let tel = "";
  if (raw.Telefono !== undefined && raw.Telefono !== null) {
    tel = String(raw.Telefono).trim();
  } else if (raw.telefono !== undefined && raw.telefono !== null) {
    tel = String(raw.telefono).trim();
  }

  const rol = String(raw.Rol_Cortejo || raw.rol || raw.Grupo || "Familia Novio").trim() || "Familia Novio";
  const estado = String(raw.Estado_Confirm || raw.Estado_Confirmacion || raw.estado || "Pendiente").trim() || "Pendiente";

  // Acompañantes
  const acompRaw = raw.Acompanantes !== undefined ? raw.Acompanantes : (raw.Acompanantes_Adicionales !== undefined ? raw.Acompanantes_Adicionales : 0);
  const acomp = parseInt(acompRaw, 10) || 0;

  const rest = String(raw.Restricciones_ || raw.Restricciones_Alimentarias || raw.restricciones || "Ninguna").trim() || "Ninguna";
  const mesa = raw.Mesa_Asignada !== undefined && raw.Mesa_Asignada !== null ? String(raw.Mesa_Asignada).trim() : "";
  const notas = raw.Notas !== undefined && raw.Notas !== null ? String(raw.Notas).trim() : "";

  return {
    ID_Invitado: id,
    Nombre_Completo: nombre || "Invitado Sin Nombre",
    Nombre_Comp: nombre || "Invitado Sin Nombre",
    Telefono: tel,
    Rol_Cortejo: rol,
    Estado_Confirmacion: estado,
    Estado_Confirm: estado,
    Acompanantes_Adicionales: acomp,
    Acompanantes: acomp,
    Restricciones_Alimentarias: rest,
    Restricciones_: rest,
    Mesa_Asignada: mesa,
    Notas: notas
  };
}

// Consulta específica con action=getInvitados para el módulo de invitados
async function fetchGuestsFromGAS(gasUrl) {
  if (!gasUrl) {
    gasUrl = (cloudConfig && cloudConfig.google_sheets_url) || localStorage.getItem("google_sheets_url") || DEFAULT_GAS_URL;
  }
  if (!gasUrl) {
    showToast("⚠️ Configura la URL de Google Sheets en ⚙️ Configurar Tasas y Meta", "warning");
    return;
  }
  try {
    const separator = gasUrl.includes("?") ? "&" : "?";
    const guestsUrl = `${gasUrl}${separator}action=getInvitados&_t=${Date.now()}`;
    const res = await fetchWithTimeout(guestsUrl, {}, 10000);
    const json = await res.json();
    let raw = [];
    if (json) {
      if (Array.isArray(json.data)) raw = json.data;
      else if (Array.isArray(json.invitados)) raw = json.invitados;
      else if (json.data && Array.isArray(json.data.invitados)) raw = json.data.invitados;
      else if (json.data && Array.isArray(json.data.Invitados)) raw = json.data.Invitados;
    }
    if (raw && raw.length > 0) {
      appData.invitados = raw.map(normalizeGuest).filter(Boolean);
      syncAppDataToLocalStorage();
      renderGuestsTab();
      updateSummaryPills();
      renderDashboard();
      showToast(`¡Lista de invitados actualizada (${appData.invitados.length} invitados)!`, "success");
      console.log(`[GAS Direct] ${appData.invitados.length} invitados sincronizados vía action=getInvitados`);
    } else {
      showToast("No se encontraron registros de invitados en la hoja", "warning");
    }
  } catch (err) {
    console.warn("[GAS Direct] Petición action=getInvitados:", err);
    showToast("⚠️ Error actualizando invitados desde la nube: " + (err.message || "Error de conexión"), "error");
  }
}
window.fetchGuestsFromGAS = fetchGuestsFromGAS;

// Enviar mutación directamente a Google Apps Script con control de errores y timeout
async function postDirectToGAS(action, payloadKey, payloadData) {
  let gasUrl = (cloudConfig.google_sheets_url || "").trim();
  try {
    if (!gasUrl) gasUrl = (localStorage.getItem("google_sheets_url") || "").trim();
  } catch (e) {}
  if (!gasUrl) gasUrl = DEFAULT_GAS_URL;

  // Validación de URL
  if (!gasUrl || !gasUrl.startsWith("https://script.google.com/") || !gasUrl.endsWith("/exec")) {
    const errorMsg = "⚠️ No se pudo guardar en la nube: Configura la URL de Apps Script (/exec) en ⚙️. Tus cambios quedaron guardados localmente.";
    updateCloudUI({ status: "error", message: "Falta configurar URL de Apps Script (/exec)" });
    showToast(errorMsg, "warning");
    return { success: false, reason: "missing_url" };
  }

  notifyCloudSyncStart();

  try {
    const bodyObj = { action: action };
    if (payloadKey) bodyObj[payloadKey] = payloadData;
    
    // Usamos fetchWithTimeout para garantizar que no se quede congelada la app sin red
    await fetchWithTimeout(gasUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyObj)
    }, 7000);

    console.log("[GAS Direct] Enviado con éxito:", action);
    updateCloudUI({ status: "synced", message: "Conectado a Google Sheets en tiempo real" });
    return { success: true };
  } catch (err) {
    console.warn("[GAS Direct] Error enviando a la nube:", err);
    updateCloudUI({ status: "error", message: err.message || "Error al sincronizar con Google Sheets" });
    showToast("⚠️ No se pudo guardar en la nube. Configura el enlace de Apps Script o verifica tu conexión. Los datos se guardaron localmente.", "warning");
    return { success: false, error: err };
  }
}

// Initialize app
function startApp() {
  if (window.appStarted) return;
  window.appStarted = true;

  // Carga inmediata de persistencia desde localStorage para evitar cualquier parpadeo
  try {
    const cachedUrl = localStorage.getItem("google_sheets_url");
    const cachedViewUrl = localStorage.getItem("google_sheets_view_url");
    cloudConfig.google_sheets_url = (cachedUrl || DEFAULT_GAS_URL).trim();
    cloudConfig.google_sheets_view_url = (cachedViewUrl || DEFAULT_GAS_VIEW_URL).trim();

    const cachedCfg = localStorage.getItem("cached_config");
    if (cachedCfg) {
      const parsed = JSON.parse(cachedCfg);
      if (parsed && typeof parsed === "object") appData.config = parsed;
    }
    const cachedEsc = localStorage.getItem("cached_escenarios_rows");
    if (cachedEsc) {
      const parsed = JSON.parse(cachedEsc);
      if (Array.isArray(parsed) && parsed.length > 0) appData.escenarios_rows = parsed;
    }
    const cachedInv = localStorage.getItem("cached_invitados");
    if (cachedInv) {
      const parsed = JSON.parse(cachedInv);
      if (Array.isArray(parsed) && parsed.length > 0) {
        appData.invitados = parsed.map(normalizeGuest).filter(Boolean);
      }
    }
    const cachedTar = localStorage.getItem("cached_tareas");
    if (cachedTar) {
      const parsed = JSON.parse(cachedTar);
      if (Array.isArray(parsed) && parsed.length > 0) appData.tareas = parsed;
    }
    const cachedProv = localStorage.getItem("cached_proveedores");
    if (cachedProv) {
      const parsed = JSON.parse(cachedProv);
      if (Array.isArray(parsed) && parsed.length > 0) appData.proveedores = parsed;
    }
    const cachedCat = localStorage.getItem("cached_catalogo");
    if (cachedCat) {
      const parsed = JSON.parse(cachedCat);
      if (Array.isArray(parsed) && parsed.length > 0) appData.catalogo = parsed;
    }
  } catch (e) {}

  initTabs();
  initHeaderControls();
  initDeleteModal();
  updateCloudUI();

  // Renderizado instantáneo preliminar con datos cacheados
  applyConfigToHeader();
  updateCountdown();
  renderGuestsTab();
  renderTasksTab();
  renderScenariosTab();
  renderDashboard();

  fetchData();
  fetchCloudConfig();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp);
} else {
  startApp();
}
setTimeout(startApp, 100);

function initDeleteModal() {
  const btnConfirm = document.getElementById("btnConfirmDeleteAction");
  if (btnConfirm) {
    btnConfirm.addEventListener("click", () => {
      if (typeof pendingDeleteAction === "function") {
        pendingDeleteAction();
      }
    });
  }
}

// Tab navigation
function initTabs() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      try {
        item.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      } catch (e) {}

      const targetId = item.getAttribute("data-tab");
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      const target = document.getElementById(targetId);
      if (target) target.classList.add("active");

      if (targetId === "tab-comparador") {
        renderComparableDropdown();
      } else if (targetId === "tab-escenarios") {
        renderScenariosTab();
      } else if (targetId === "tab-invitados") {
        renderGuestsTab();
        const gasUrl = (cloudConfig.google_sheets_url || localStorage.getItem("google_sheets_url") || "").trim();
        if (gasUrl && (!appData.invitados || appData.invitados.length === 0)) {
          fetchGuestsFromGAS(gasUrl);
        }
      } else if (targetId === "tab-logistica") {
        renderTasksTab();
      } else if (targetId === "tab-proveedores") {
        if (currentViewingProviderId) {
          const p = appData.proveedores.find(x => x.ID_Proveedor === currentViewingProviderId);
          if (p) {
            renderProviderDetailHeader(p);
            renderProviderProductsTable(currentViewingProviderId);
          } else {
            backToProvidersList();
          }
        } else {
          renderProviders();
        }
      }
    });
  });
}

// Renderizado seguro por módulos para que errores en vistas individuales no rompan la sincronización
function safeRender(moduleName, renderFn) {
  try {
    if (typeof renderFn === "function") {
      renderFn();
    }
  } catch (err) {
    console.error(`[safeRender] Error al renderizar ${moduleName}:`, err);
  }
}
window.safeRender = safeRender;

// Fetch all data directly from Google Apps Script Web App (/exec)
async function fetchData() {
  await syncFromGASDirect();
}

async function syncFromGASDirect() {
  let gasUrl = (cloudConfig.google_sheets_url || "").trim();
  try {
    if (!gasUrl) gasUrl = (localStorage.getItem("google_sheets_url") || "").trim();
  } catch(e) {}
  if (!gasUrl) gasUrl = DEFAULT_GAS_URL;

  const headerIcon = document.getElementById("cloudStatusIcon");
  const headerText = document.getElementById("cloudStatusText");
  const headerBadge = document.getElementById("cloudStatusBadge");
  if (headerBadge) headerBadge.className = "summary-pill cloud-pill cloud-syncing";
  if (headerIcon) headerIcon.textContent = "🟡";
  if (headerText) headerText.textContent = "Sincronizando...";

  let json = null;
  // 1. Aislamiento estricto de red: solo errores HTTP o de conexión disparan catch de red
  try {
    const res = await fetchWithTimeout(gasUrl, {}, 14000);
    json = await res.json();
    if (!json || !json.success || !json.data) {
      throw new Error((json && json.error) || "No se recibieron datos de la hoja");
    }
  } catch (err) {
    console.warn("[GAS Direct Network Error]:", err);
    updateCloudUI({ status: "error", message: err.message || "Error al conectar con Google Sheets" });
    showToast("⚠️ " + (err.message || "Error al conectar con Google Sheets"), "error");
    return false;
  }

  // 2. Extracción y persistencia de datos (si la red respondió exitosa)
  try {
    isDataLoaded = true;
    window.isDataLoaded = true;
    const d = json.data;
    appData.config = d.config || d.Configuracion || appData.config || {};
    appData.proveedores = Array.isArray(d.proveedores) ? d.proveedores : (Array.isArray(d.Proveedores) ? d.Proveedores : []);
    appData.catalogo = Array.isArray(d.catalogo) ? d.catalogo : (Array.isArray(d.Catalogo_Precios) ? d.Catalogo_Precios : []);
    appData.escenarios_rows = Array.isArray(d.escenarios_rows) ? d.escenarios_rows : (Array.isArray(d.Escenarios_Presupuesto) ? d.Escenarios_Presupuesto : []);

    const rawGuests = Array.isArray(d.invitados) ? d.invitados : (Array.isArray(d.Invitados) ? d.Invitados : (Array.isArray(json.invitados) ? json.invitados : []));
    appData.invitados = rawGuests.map(normalizeGuest).filter(Boolean);

    appData.tareas = Array.isArray(d.tareas) ? d.tareas : (Array.isArray(d.Logistica) ? d.Logistica : (Array.isArray(d.logistica) ? d.logistica : []));

    syncAppDataToLocalStorage();

    // Si la hoja general vino sin invitados, consultar explícitamente action=getInvitados
    if (appData.invitados.length === 0) {
      fetchGuestsFromGAS(gasUrl);
    }
  } catch (dataErr) {
    console.error("[GAS Direct Data Parsing Error]:", dataErr);
  }

  // 3. Confirmación de Nube Sincronizada ANTES del renderizado
  updateCloudUI({ status: "synced", message: "Conectado a Google Sheets en tiempo real" });
  showToast("¡Base de datos sincronizada con Google Sheets (6 pestañas)! ☁️", "success");

  // 4. Renderizado seguro módulo por módulo: fallas en un módulo no tumban el estado de la nube
  safeRender("updateCategoryControls", updateCategoryControls);
  safeRender("applyConfigToHeader", applyConfigToHeader);
  safeRender("updateCountdown", updateCountdown);
  safeRender("renderDashboard", renderDashboard);
  safeRender("renderGuestsTab", renderGuestsTab);
  safeRender("renderTasksTab", renderTasksTab);
  safeRender("renderProviders", () => {
    if (currentViewingProviderId) {
      const p = appData.proveedores.find(x => x.ID_Proveedor === currentViewingProviderId);
      if (p) {
        renderProviderDetailHeader(p);
        renderProviderProductsTable(currentViewingProviderId);
      } else {
        backToProvidersList();
      }
    } else {
      renderProviders();
    }
  });
  safeRender("renderComparableDropdown", renderComparableDropdown);
  safeRender("renderScenariosTab", renderScenariosTab);

  return true;
}

// Abrir Manual de Usuario interactivo y PDF
window.openManual = function() {
  openModal('modalManual');
};

// ==========================================
// DICCIONARIO DE TOOLTIPS INTERACTIVOS (HOVER / TAP ⓘ)
// ==========================================
const FINANCIAL_TOOLTIP_DATA = {
  costo_binance: {
    title: "🪙 Costo Binance (USDT)",
    body: "Total neto en dólares equivalentes si pagaras en Bs cambiados a tasa Binance o USDT directo. Si pagas a tasa BCV en bolívares, este indicador refleja el costo real de bolsillo descontando el diferencial cambiario."
  },
  dolar_nominal: {
    title: "💵 Dólar Nominal ($)",
    body: "Monto contractual o precio de lista según la tasa o moneda fijada por el proveedor antes de aplicar cualquier conversión o ahorro por brecha cambiaria."
  },
  costo_invitado: {
    title: "👥 Costo por Invitado",
    body: "Inversión total dividida entre el número de invitados confirmados o estimados (incluyendo acompañantes). Permite medir la eficiencia del gasto por asistente."
  },
  silla_marginal: {
    title: "🪑 1 Silla Más (Marginal)",
    body: "Costo incremental variable que cuesta invitar a una persona adicional (comida, cotillón, centros de mesa variables), excluyendo costos fijos como fotografía o alquiler del salón."
  },
  ahorro_brecha: {
    title: "📉 Ahorro Brecha BCV vs Binance",
    body: "Diferencia a favor si pagas a tasa oficial BCV con bolívares adquiridos o valuados a la tasa de mercado Binance/USDT. A mayor brecha, mayor es el ahorro real."
  },
  arqueo_caja: {
    title: "💼 Arqueo de Caja",
    body: "Distribución de tus fondos entre Efectivo, Cuentas en Bs, Binance y Divisas para planificar los pagos según la modalidad exigida por cada proveedor."
  }
};

window.openTooltipModal = function(key) {
  const data = FINANCIAL_TOOLTIP_DATA[key];
  if (!data) return;
  const titleEl = document.getElementById("tooltipTitle");
  const bodyEl = document.getElementById("tooltipBody");
  if (titleEl) titleEl.innerHTML = `<span>💡</span> <span>${escapeHtml(data.title)}</span>`;
  if (bodyEl) bodyEl.innerHTML = `<p style="margin:0; font-size:13.5px; line-height:1.6; color:#2C3E50;">${escapeHtml(data.body)}</p>`;
  openModal("modalTooltip");
};

window.closeTooltipModal = function() {
  closeModal("modalTooltip");
};

// Control global del Modal de Configuración y Sincronización
window.openConfigModal = function(focusCloud = true) {
  const drawer = document.getElementById("configDrawer");
  const btnToggle = document.getElementById("btnToggleConfig");
  const arrow = document.getElementById("configToggleArrow");
  if (!drawer) return;
  drawer.classList.add("open");
  drawer.classList.add("active");
  drawer.style.display = "flex";
  if (btnToggle) btnToggle.classList.add("active");
  if (arrow) arrow.textContent = "▲";

  if (focusCloud) {
    const inputUrl = document.getElementById("inputGoogleSheetsUrl");
    if (inputUrl) {
      setTimeout(() => {
        inputUrl.focus();
        try { inputUrl.select(); } catch(e) {}
      }, 120);
    }
  }
};

window.closeConfigModal = function() {
  const drawer = document.getElementById("configDrawer");
  const btnToggle = document.getElementById("btnToggleConfig");
  const arrow = document.getElementById("configToggleArrow");
  if (!drawer) return;
  drawer.classList.remove("open");
  drawer.classList.remove("active");
  drawer.style.display = "none";
  if (btnToggle) btnToggle.classList.remove("active");
  if (arrow) arrow.textContent = "▾";
};

let lastToggleTime = 0;
window.toggleConfigModal = function(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const now = Date.now();
  if (now - lastToggleTime < 250) return; // Evitar rebote o doble disparo
  lastToggleTime = now;

  const drawer = document.getElementById("configDrawer");
  if (!drawer) return;
  const isOpen = drawer.classList.contains("open") || drawer.classList.contains("active") || drawer.style.display === "flex";
  if (isOpen) {
    window.closeConfigModal();
  } else {
    window.openConfigModal(false);
  }
};

window.handleHeaderSyncClick = function(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  let effectiveUrl = (cloudConfig.google_sheets_url || "").trim();
  try {
    if (!effectiveUrl) effectiveUrl = (localStorage.getItem("google_sheets_url") || "").trim();
  } catch (err) {}

  if (!effectiveUrl) {
    showToast("⚠️ Pega la URL de Google Sheets (/exec) para conectar la nube", "warning");
    window.openConfigModal(true);
    return;
  }
  triggerCloudSyncHeader();
};

// Config & Header Controls
function initHeaderControls() {
  const badge = document.getElementById("countdownBadge");
  const dateInput = document.getElementById("weddingDateInput");
  const btnToggle = document.getElementById("btnToggleConfig");
  const btnManual = document.getElementById("btnOpenManual");
  const drawer = document.getElementById("configDrawer");
  const arrow = document.getElementById("configToggleArrow");
  const btnClose = document.getElementById("btnCloseDrawer");
  const btnCloseX = document.getElementById("btnCloseConfigModalX");

  if (btnManual) {
    btnManual.onclick = (e) => {
      e.preventDefault();
      window.openManual();
    };
  }

  function toggleDrawer(open) {
    if (open === true) {
      window.openConfigModal(false);
    } else if (open === false) {
      window.closeConfigModal();
    } else {
      window.toggleConfigModal();
    }
  }

  if (btnToggle) {
    btnToggle.onclick = (e) => {
      e.stopPropagation();
      window.toggleConfigModal(e);
    };
  }

  if (btnClose) {
    btnClose.onclick = (e) => {
      e.stopPropagation();
      window.closeConfigModal();
    };
  }

  if (btnCloseX) {
    btnCloseX.onclick = (e) => {
      e.stopPropagation();
      window.closeConfigModal();
    };
  }

  // Cierre al presionar Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      window.closeConfigModal();
    }
  });

  if (drawer) {
    drawer.addEventListener("click", (e) => {
      if (e.target === drawer) {
        window.closeConfigModal();
      }
    });
  }

  if (badge) {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      window.openConfigModal(false);
      if (dateInput) {
        setTimeout(() => {
          dateInput.showPicker ? dateInput.showPicker() : dateInput.focus();
        }, 150);
      }
    });
  }

  const decBadge = document.getElementById("decisionCountdownBadge");
  const decDateInput = document.getElementById("decisionDateInput");

  if (decBadge) {
    decBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      window.openConfigModal(false);
      if (decDateInput) {
        setTimeout(() => {
          decDateInput.showPicker ? decDateInput.showPicker() : decDateInput.focus();
        }, 150);
      }
    });
  }

  if (dateInput) {
    dateInput.addEventListener("change", (e) => {
      appData.config.Fecha_Boda = e.target.value;
      updateCountdown();
      debouncedSaveConfig();
    });
  }

  if (decDateInput) {
    decDateInput.addEventListener("change", (e) => {
      appData.config.Fecha_Decision = e.target.value;
      updateCountdown();
      debouncedSaveConfig();
    });
  }

  const inputs = [
    { id: "inputGuests", key: "Invitados_Base", isInt: true },
    { id: "inputBudgetMeta", key: "Presupuesto_Meta_USD", isFloat: true },
    { id: "inputBudgetTecho", key: "Presupuesto_Techo_USD", isFloat: true },
    { id: "inputRateUsdBcv", key: "Tasa_USD_BCV", isFloat: true },
    { id: "inputRateEurBcv", key: "Tasa_EUR_BCV", isFloat: true },
    { id: "inputRateUsdt", key: "Tasa_Efectivo_USDT", isFloat: true }
  ];

  inputs.forEach(inp => {
    const el = document.getElementById(inp.id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      let val = e.target.value;
      if (inp.isInt) val = parseInt(val) || 0;
      else if (inp.isFloat) val = parseFloat(val) || 0;
      appData.config[inp.key] = val;
      updateSummaryPills();
      renderDashboard();
      renderProviders();
      const tabEsc = document.getElementById("tab-escenarios");
      if (tabEsc && tabEsc.classList.contains("active")) {
        renderScenariosTab();
      }
      debouncedSaveConfig();
    });
  });

  const btnSyncBcv = document.getElementById("btnSyncBcv");
  if (btnSyncBcv) btnSyncBcv.addEventListener("click", syncBcvRates);
  const btnReloadExcel = document.getElementById("btnReloadExcel");
  if (btnReloadExcel) {
    btnReloadExcel.addEventListener("click", () => {
      fetchData();
      showToast("Datos recargados exitosamente", "success");
    });
  }

  const btnConnectCloud = document.getElementById("btnConnectCloud");
  if (btnConnectCloud) {
    btnConnectCloud.addEventListener("click", connectAndSyncCloud);
  }

  const inputGoogleSheetsUrl = document.getElementById("inputGoogleSheetsUrl");
  if (inputGoogleSheetsUrl) {
    inputGoogleSheetsUrl.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      localStorage.setItem("google_sheets_url", val);
      cloudConfig.google_sheets_url = val;
    });
    inputGoogleSheetsUrl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        connectAndSyncCloud();
      }
    });
  }

  const inputGoogleSheetsViewUrl = document.getElementById("inputGoogleSheetsViewUrl");
  if (inputGoogleSheetsViewUrl) {
    inputGoogleSheetsViewUrl.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      localStorage.setItem("google_sheets_view_url", val);
      cloudConfig.google_sheets_view_url = val;
    });
  }

  const btnSyncCloudHeader = document.getElementById("btnSyncCloudHeader");
  if (btnSyncCloudHeader) {
    btnSyncCloudHeader.onclick = (e) => {
      e.stopPropagation();
      window.handleHeaderSyncClick(e);
    };
  }

  const cloudStatusBadge = document.getElementById("cloudStatusBadge");
  if (cloudStatusBadge) {
    cloudStatusBadge.onclick = (e) => {
      e.stopPropagation();
      window.openConfigModal(true);
    };
  }

  const chkColchon = document.getElementById("chkColchonImprevistos");
  chkColchon.addEventListener("change", (e) => {
    appData.config.Aplicar_Colchon_Imprevistos = e.target.checked ? "SI" : "NO";
    renderDashboard();
    debouncedSaveConfig();
  });

  document.getElementById("selectActiveScenario").addEventListener("change", (e) => {
    activeScenarioId = e.target.value;
    renderDashboard();
  });

  document.getElementById("btnAutoMinBudget").addEventListener("click", createAutoMinBudget);
  document.getElementById("searchProviders").addEventListener("input", renderProviders);
  document.getElementById("filterRubro").addEventListener("change", renderProviders);
  const selCompProd = document.getElementById("selectComparableProduct");
  if (selCompProd) selCompProd.addEventListener("change", renderComparisonItems);
  const selCompPreset = document.getElementById("selectComparablePreset");
  if (selCompPreset) selCompPreset.addEventListener("change", (e) => applyComparablePreset(e.target.value));

  const searchScen = document.getElementById("searchScenarioItems");
  if (searchScen) searchScen.addEventListener("input", renderScenariosTab);
  const filterScenCat = document.getElementById("filterScenarioCategory");
  if (filterScenCat) filterScenCat.addEventListener("change", renderScenariosTab);

  // Invitados controls
  const searchG = document.getElementById("searchGuests");
  if (searchG) searchG.addEventListener("input", renderGuestsTab);
  const filterGSt = document.getElementById("filterGuestStatus");
  if (filterGSt) filterGSt.addEventListener("change", renderGuestsTab);
  const filterGRole = document.getElementById("filterGuestRole");
  if (filterGRole) filterGRole.addEventListener("change", renderGuestsTab);

  // Logística controls
  const searchT = document.getElementById("searchTasks");
  if (searchT) searchT.addEventListener("input", renderTasksTab);
  const filterTSt = document.getElementById("filterTaskStatus");
  if (filterTSt) filterTSt.addEventListener("change", renderTasksTab);
  const filterTAss = document.getElementById("filterTaskAssignee");
  if (filterTAss) filterTAss.addEventListener("change", renderTasksTab);
  const filterTCat = document.getElementById("filterTaskCategory");
  if (filterTCat) filterTCat.addEventListener("change", renderTasksTab);
}

function adjustGuests(delta) {
  const current = parseInt(appData.config.Invitados_Base) || 100;
  const next = Math.max(1, current + delta);
  appData.config.Invitados_Base = next;
  document.getElementById("inputGuests").value = next;
  updateSummaryPills();
  renderDashboard();
  debouncedSaveConfig();
}

function updateSummaryPills() {
  const cfg = appData.config || {};
  const guests = parseInt(cfg.Invitados_Base) || 100;
  const meta = parseFloat(cfg.Presupuesto_Meta_USD) || 2500;
  const techo = parseFloat(cfg.Presupuesto_Techo_USD) || 3200;
  const bcvUsd = parseFloat(cfg.Tasa_USD_BCV) || 45.50;
  const bcvEur = parseFloat(cfg.Tasa_EUR_BCV) || 49.80;
  const usdt = parseFloat(cfg.Tasa_Binance || cfg.Tasa_Efectivo_USDT) || 54.00;

  const elGuests = document.getElementById("summaryGuests");
  if (elGuests) elGuests.textContent = `${guests} Inv.`;

  const elBudget = document.getElementById("summaryBudget");
  if (elBudget) elBudget.textContent = `$${Math.round(meta).toLocaleString("en-US")} - $${Math.round(techo).toLocaleString("en-US")}`;

  const elBcv = document.getElementById("summaryBcv");
  if (elBcv) elBcv.textContent = `Dólar BCV: ${bcvUsd.toFixed(2)} Bs`;

  const elEur = document.getElementById("summaryEurBcv");
  if (elEur) elEur.textContent = `Euro BCV: ${bcvEur.toFixed(2)} Bs`;

  const elBin = document.getElementById("summaryBinance") || document.getElementById("summaryBinanceRate");
  if (elBin) elBin.textContent = `Tasa Binance: ${usdt.toFixed(2)} Bs`;
}

// ==========================================
// Categorías y Rubros Maestros Asana (4 Pilares + CRUD)
// ==========================================
const MASTER_ASANA_CATEGORIES = ["Comida", "Decoración", "Vestimenta", "Logística"];

const ASANA_CATEGORY_SYNONYMS = {
  "comida": "Comida", "alimentacion": "Comida", "alimentación": "Comida", "catering": "Comida",
  "bebida": "Comida", "bebidas": "Comida", "reposteria": "Comida", "repostería": "Comida",
  "torta": "Comida", "tortas": "Comida", "dulces": "Comida", "barra": "Comida",
  "cocteleria": "Comida", "coctelería": "Comida", "pasapalos": "Comida", "banquete": "Comida",
  "alimentos y bebidas (catering)": "Comida", "torta y dulces": "Comida",
  "decoracion": "Decoración", "decoración": "Decoración", "flores": "Decoración", "floristería": "Decoración",
  "mobiliario": "Decoración", "iluminacion": "Decoración", "iluminación": "Decoración",
  "ambientacion": "Decoración", "ambientación": "Decoración", "montaje": "Decoración",
  "decoración y flores": "Decoración",
  "vestimenta": "Vestimenta", "traje": "Vestimenta", "trajes": "Vestimenta", "vestido": "Vestimenta",
  "vestidos": "Vestimenta", "maquillaje": "Vestimenta", "peinado": "Vestimenta", "calzado": "Vestimenta",
  "accesorios": "Vestimenta", "joyeria": "Vestimenta", "joyería": "Vestimenta", "estilismo": "Vestimenta",
  "vestuario y belleza": "Vestimenta", "anillos y joyería": "Vestimenta",
  "logistica": "Logística", "logística": "Logística", "transporte": "Logística", "fotografia": "Logística",
  "fotografía": "Logística", "video": "Logística", "audiovisual": "Logística", "sonido": "Logística",
  "musica": "Logística", "música": "Logística", "protocolo": "Logística", "seguridad": "Logística",
  "general": "Logística", "coordinacion": "Logística", "coordinación": "Logística",
  "papeleria": "Logística", "papelería": "Logística", "invitaciones": "Logística", "salon": "Logística",
  "salón": "Logística", "locacion": "Logística", "locación": "Logística",
  "espacio / salón": "Logística", "fotografía y video": "Logística",
  "música, sonido e iluminación": "Logística", "papelería y recuerdos": "Logística",
  "transporte y logística": "Logística", "otros": "Logística"
};

function getAllCategories() {
  const fromProv = (appData.proveedores || []).map(p => (p.Rubro_General || "").trim());
  const fromCat = (appData.catalogo || []).map(c => (c.Categoria || "").trim());
  const fromScen = (appData.escenarios_rows || []).map(r => (r.Categoria || "").trim());
  const fromTasks = (appData.tareas || []).map(t => (t.Categoria_Logistica || "").trim());

  const set = new Set([...MASTER_ASANA_CATEGORIES, ...fromProv, ...fromCat, ...fromScen, ...fromTasks].filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function updateCategoryControls() {
  const allCats = getAllCategories();

  // Datalist Proveedores
  const dlProv = document.getElementById("listRubrosProveedores");
  if (dlProv) {
    dlProv.innerHTML = allCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  // Datalist Productos
  const dlItems = document.getElementById("listItemCategorias");
  if (dlItems) {
    dlItems.innerHTML = allCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join("");
  }

  // Filtro de proveedores
  const filterProv = document.getElementById("filterRubro");
  if (filterProv) {
    const curr = filterProv.value;
    filterProv.innerHTML = `<option value="">Todos los Rubros / Categorías</option>` +
      allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (curr && allCats.includes(curr)) {
      filterProv.value = curr;
    }
  }

  // Filtro de escenarios
  const filterScen = document.getElementById("filterScenarioCategory");
  if (filterScen) {
    const curr = filterScen.value;
    filterScen.innerHTML = `<option value="">Todas las Categorías</option>` +
      allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (curr && allCats.includes(curr)) {
      filterScen.value = curr;
    }
  }

  // Category pills for active inputs if open
  renderCategoryPills("quickRubroPills", "provRubro", allCats);
  renderCategoryPills("quickItemCatPills", "itemCategoria", allCats);
}

function renderCategoryPills(containerId, inputId, categories) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  const currentVal = (input.value || "").trim().toLowerCase();
  container.innerHTML = "";

  const list = categories || getAllCategories();
  list.slice(0, 8).forEach(cat => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip" + (cat.toLowerCase() === currentVal ? " active" : "");
    chip.textContent = cat;
    chip.addEventListener("click", () => {
      input.value = cat;
      renderCategoryPills(containerId, inputId, list);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    container.appendChild(chip);
  });
}

function populateCategoryDropdown() {
  try {
    updateCategoryControls();

    const allCats = (typeof getAllCategories === "function") ? getAllCategories() : [];

    // Safely update itemCategoria if present as a select
    const itemCatSelect = document.getElementById("itemCategoria");
    if (itemCatSelect && itemCatSelect.tagName === "SELECT") {
      const currentVal = itemCatSelect.value;
      itemCatSelect.innerHTML = allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      if (currentVal && allCats.includes(currentVal)) {
        itemCatSelect.value = currentVal;
      }
    }

    // Safely update provRubro if present as a select
    const provRubroSelect = document.getElementById("provRubro");
    if (provRubroSelect && provRubroSelect.tagName === "SELECT") {
      const currentVal = provRubroSelect.value;
      provRubroSelect.innerHTML = allCats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      if (currentVal && allCats.includes(currentVal)) {
        provRubroSelect.value = currentVal;
      }
    }
  } catch (err) {
    console.warn("[populateCategoryDropdown] Ignored non-critical error:", err);
  }
}

function escapeJs(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}
window.escapeJs = escapeJs;

// ==========================================
// GESTOR DE CATEGORÍAS MAESTRAS (CRUD & NORMALIZACIÓN ASANA)
// ==========================================
window.openCategoriesManagerModal = function() {
  renderCategoriesManagerList();
  openModal("modalManageCategories");
};

window.renderCategoriesManagerList = function() {
  const container = document.getElementById("categoriesListContainer");
  if (!container) return;

  const allCats = getAllCategories();
  if (allCats.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding:24px; color:var(--text-secondary); font-size:13px;">No hay categorías registradas.</div>`;
    return;
  }

  let html = `<div style="display:flex; flex-direction:column;">`;
  allCats.forEach(cat => {
    const provCount = (appData.proveedores || []).filter(p => (p.Rubro_General || "").trim().toLowerCase() === cat.toLowerCase()).length;
    const catCount = (appData.catalogo || []).filter(c => (c.Categoria || "").trim().toLowerCase() === cat.toLowerCase()).length;
    const taskCount = (appData.tareas || []).filter(t => (t.Categoria_Logistica || "").trim().toLowerCase() === cat.toLowerCase()).length;
    const totalUsage = provCount + catCount + taskCount;
    const isMaster = MASTER_ASANA_CATEGORIES.some(m => m.toLowerCase() === cat.toLowerCase());

    html += `
      <div class="cat-manager-row" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid rgba(0,0,0,0.06);">
        <div>
          <div style="font-weight:700; font-size:13.5px; color:#1D1D1F; display:flex; align-items:center; gap:6px;">
            <span>🏷️</span>
            <span>${escapeHtml(cat)}</span>
            ${isMaster ? '<span style="background:#E8F8EE; color:#1B8738; font-size:10px; font-weight:800; padding:1px 6px; border-radius:6px;">Maestra</span>' : ''}
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
            ${totalUsage} vinculaciones (${provCount} prov, ${catCount} prod, ${taskCount} tareas)
          </div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button type="button" class="btn btn-secondary mini-btn" onclick="renameCategoryAction('${escapeJs(cat)}')">
            ✏️ Renombrar
          </button>
          <button type="button" class="btn btn-danger mini-btn" onclick="deleteCategoryAction('${escapeJs(cat)}', ${totalUsage})">
            🗑️
          </button>
        </div>
      </div>
    `;
  });
  html += `</div>`;
  container.innerHTML = html;
};

window.addNewCategoryAction = function() {
  const input = document.getElementById("inputNewCategoryName");
  const val = (input ? input.value : "").trim();
  if (!val) {
    showToast("Por favor ingresa un nombre para la categoría", "warning");
    return;
  }
  const allCats = getAllCategories();
  if (allCats.some(c => c.toLowerCase() === val.toLowerCase())) {
    showToast(`La categoría "${val}" ya existe`, "warning");
    return;
  }
  MASTER_ASANA_CATEGORIES.push(val);
  if (input) input.value = "";
  renderCategoriesManagerList();
  updateCategoryControls();
  showToast(`Categoría "${val}" agregada`, "success");
};

window.renameCategoryAction = async function(oldCat) {
  const newCat = prompt(`Ingresa el nuevo nombre para "${oldCat}":`, oldCat);
  if (!newCat || newCat.trim() === "" || newCat.trim() === oldCat) return;
  const target = newCat.trim();

  let modifiedCount = 0;
  (appData.proveedores || []).forEach(p => {
    if ((p.Rubro_General || "").trim().toLowerCase() === oldCat.toLowerCase()) {
      p.Rubro_General = target;
      modifiedCount++;
    }
  });
  (appData.catalogo || []).forEach(c => {
    if ((c.Categoria || "").trim().toLowerCase() === oldCat.toLowerCase()) {
      c.Categoria = target;
      modifiedCount++;
    }
  });
  (appData.tareas || []).forEach(t => {
    if ((t.Categoria_Logistica || "").trim().toLowerCase() === oldCat.toLowerCase()) {
      t.Categoria_Logistica = target;
      modifiedCount++;
    }
  });
  (appData.escenarios_rows || []).forEach(r => {
    if ((r.Categoria || "").trim().toLowerCase() === oldCat.toLowerCase()) {
      r.Categoria = target;
    }
  });

  const idx = MASTER_ASANA_CATEGORIES.findIndex(c => c.toLowerCase() === oldCat.toLowerCase());
  if (idx !== -1) MASTER_ASANA_CATEGORIES[idx] = target;
  else MASTER_ASANA_CATEGORIES.push(target);

  syncAppDataToLocalStorage();
  renderCategoriesManagerList();
  updateCategoryControls();
  renderProviders();
  renderTasksTab();
  showToast(`Categoría renombrada a "${target}" (${modifiedCount} actualizados)`, "success");

  await postDirectToGAS("rename_category", "renameData", { oldName: oldCat, newName: target });
};

window.deleteCategoryAction = function(cat, totalUsage) {
  if (totalUsage > 0) {
    if (!confirm(`La categoría "${cat}" tiene ${totalUsage} registros vinculados. Si la eliminas, esos registros pasarán a "Logística". ¿Deseas continuar?`)) return;
    (appData.proveedores || []).forEach(p => {
      if ((p.Rubro_General || "").trim().toLowerCase() === cat.toLowerCase()) p.Rubro_General = "Logística";
    });
    (appData.catalogo || []).forEach(c => {
      if ((c.Categoria || "").trim().toLowerCase() === cat.toLowerCase()) c.Categoria = "Logística";
    });
    (appData.tareas || []).forEach(t => {
      if ((t.Categoria_Logistica || "").trim().toLowerCase() === cat.toLowerCase()) t.Categoria_Logistica = "Logística";
    });
    (appData.escenarios_rows || []).forEach(r => {
      if ((r.Categoria || "").trim().toLowerCase() === cat.toLowerCase()) r.Categoria = "Logística";
    });
  } else {
    if (!confirm(`¿Eliminar la categoría "${cat}"?`)) return;
  }

  const idx = MASTER_ASANA_CATEGORIES.findIndex(c => c.toLowerCase() === cat.toLowerCase());
  if (idx !== -1) MASTER_ASANA_CATEGORIES.splice(idx, 1);

  syncAppDataToLocalStorage();
  renderCategoriesManagerList();
  updateCategoryControls();
  renderProviders();
  renderTasksTab();
  showToast(`Categoría "${cat}" eliminada`, "info");
};

window.triggerAsanaNormalization = async function() {
  if (!confirm("¿Deseas normalizar automáticamente todos los proveedores, catálogo y tareas a los 4 Pilares Maestros de Asana (Comida, Decoración, Vestimenta, Logística)?")) return;

  let changes = 0;
  function norm(str) {
    if (!str) return "Logística";
    const clean = str.trim().toLowerCase();
    if (ASANA_CATEGORY_SYNONYMS[clean]) return ASANA_CATEGORY_SYNONYMS[clean];
    for (const [key, val] of Object.entries(ASANA_CATEGORY_SYNONYMS)) {
      if (clean.includes(key)) return val;
    }
    return "Logística";
  }

  (appData.proveedores || []).forEach(p => {
    const prev = p.Rubro_General;
    p.Rubro_General = norm(prev);
    if (prev !== p.Rubro_General) changes++;
  });
  (appData.catalogo || []).forEach(c => {
    const prev = c.Categoria;
    c.Categoria = norm(prev);
    if (prev !== c.Categoria) changes++;
  });
  (appData.tareas || []).forEach(t => {
    const prev = t.Categoria_Logistica;
    t.Categoria_Logistica = norm(prev);
    if (prev !== t.Categoria_Logistica) changes++;
  });
  (appData.escenarios_rows || []).forEach(r => {
    const prev = r.Categoria;
    r.Categoria = norm(prev);
  });

  syncAppDataToLocalStorage();
  renderCategoriesManagerList();
  updateCategoryControls();
  renderProviders();
  renderTasksTab();
  showToast(`✨ ¡Normalización completada! ${changes} registros actualizados a los 4 pilares Asana.`, "success");

  await postDirectToGAS("normalize_categories", null, null);
};

function applyConfigToHeader() {
  const cfg = appData.config || {};
  const wedDateInp = document.getElementById("weddingDateInput");
  if (wedDateInp) wedDateInp.value = cfg.Fecha_Boda || "2027-06-15";
  const decDateInp = document.getElementById("decisionDateInput");
  if (decDateInp) decDateInp.value = cfg.Fecha_Decision || "";
  const inpGuests = document.getElementById("inputGuests");
  if (inpGuests) inpGuests.value = cfg.Invitados_Base || 100;
  const inpMeta = document.getElementById("inputBudgetMeta");
  if (inpMeta) inpMeta.value = cfg.Presupuesto_Meta_USD || 2500;
  const inpTecho = document.getElementById("inputBudgetTecho");
  if (inpTecho) inpTecho.value = cfg.Presupuesto_Techo_USD || 3200;
  const inpUsd = document.getElementById("inputRateUsdBcv");
  if (inpUsd) inpUsd.value = cfg.Tasa_USD_BCV || 45.50;
  const inpEur = document.getElementById("inputRateEurBcv");
  if (inpEur) inpEur.value = cfg.Tasa_EUR_BCV || 49.80;
  const inpUsdt = document.getElementById("inputRateUsdt");
  if (inpUsdt) inpUsdt.value = cfg.Tasa_Efectivo_USDT || 54.00;
  const chkColchon = document.getElementById("chkColchonImprevistos");
  if (chkColchon) chkColchon.checked = (cfg.Aplicar_Colchon_Imprevistos || "").toUpperCase() === "SI";
  updateSummaryPills();
}

function updateCountdown() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Contador Boda
  const targetDate = new Date(appData.config.Fecha_Boda || "2027-06-15");
  targetDate.setHours(0, 0, 0, 0);
  const diffTime = targetDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const elDays = document.getElementById("countdownDays");
  if (elDays) elDays.textContent = isNaN(diffDays) ? "--" : diffDays;

  // 2. Contador Fecha de Decisión
  const decBadge = document.getElementById("decisionCountdownBadge");
  const decDateStr = appData.config.Fecha_Decision;

  if (decBadge) {
    if (decDateStr) {
      const decDate = new Date(decDateStr);
      decDate.setHours(0, 0, 0, 0);
      const decDiff = decDate - today;
      const decDays = Math.ceil(decDiff / (1000 * 60 * 60 * 24));
      if (!isNaN(decDays)) {
        if (decDays > 0) {
          decBadge.className = "summary-pill countdown-pill decision-countdown-pill";
          decBadge.innerHTML = `<span>⚖️</span> Fecha de Decisión: <strong>${decDays} d</strong>`;
          decBadge.title = `Faltan ${decDays} días para la Fecha de Decisión (${decDateStr})`;
        } else if (decDays === 0) {
          decBadge.className = "summary-pill countdown-pill decision-countdown-pill decision-today";
          decBadge.innerHTML = `<span>⚖️</span> Fecha de Decisión: <strong>¡Hoy!</strong>`;
          decBadge.title = `¡Hoy es la Fecha de Decisión de viabilidad! (${decDateStr})`;
        } else {
          decBadge.className = "summary-pill countdown-pill decision-countdown-pill decision-expired";
          decBadge.innerHTML = `<span>⚠️</span> Decisión: <strong>Vencida hace ${Math.abs(decDays)} d</strong>`;
          decBadge.title = `La Fecha de Decisión venció hace ${Math.abs(decDays)} días (${decDateStr})`;
        }
      }
    } else {
      decBadge.className = "summary-pill countdown-pill decision-countdown-pill decision-unset";
      decBadge.innerHTML = `<span>⚖️</span> Fecha de Decisión: <strong>Definir</strong>`;
      decBadge.title = "Haz clic para configurar la Fecha Límite de Decisión de viabilidad en ⚙️";
    }
  }
}

function debouncedSaveConfig() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    syncAppDataToLocalStorage();
    postDirectToGAS("save_config", "config", appData.config);
  }, 600);
}

// Sincronizar Tasas (Dólar BCV, Euro BCV, Binance)
async function syncBcvRates() {
  const btn = document.getElementById("btnSyncBcv");
  if (btn) {
    btn.innerHTML = `<span>⏳</span> Consultando...`;
    btn.disabled = true;
  }

  let usdFound = 0;
  let eurFound = 0;
  let binanceFound = 0;

  try {
    // 1. Si hay conexión a Google Apps Script, usar el backend scraper (sin bloqueos CORS)
    if (cloudConfig && cloudConfig.google_sheets_url && cloudConfig.google_sheets_url.startsWith("http")) {
      try {
        const gasUrl = cloudConfig.google_sheets_url + (cloudConfig.google_sheets_url.includes("?") ? "&" : "?") + "action=sync_bcv_rates";
        const gasRes = await fetchWithTimeout(gasUrl, {}, 8000);
        if (gasRes.ok) {
          const gasData = await gasRes.json();
          if (gasData && gasData.success && gasData.rates) {
            usdFound = parseFloat(gasData.rates.Tasa_USD_BCV) || 0;
            eurFound = parseFloat(gasData.rates.Tasa_EUR_BCV) || 0;
            binanceFound = parseFloat(gasData.rates.Tasa_Binance) || 0;
          }
        }
      } catch (gasErr) {
        console.warn("GAS scraper rate fetch failed, using direct API fallbacks:", gasErr);
      }
    }

    // 2. Fallbacks directos desde API venezolana oficial
    if (!usdFound) {
      try {
        const resUsd = await fetchWithTimeout("https://ve.dolarapi.com/v1/dolares/oficial", {}, 6000);
        const jsonUsd = await resUsd.json();
        if (jsonUsd && jsonUsd.promedio) usdFound = parseFloat(jsonUsd.promedio) || 0;
      } catch(e1) {}
    }

    if (!eurFound) {
      try {
        const resEur = await fetchWithTimeout("https://ve.dolarapi.com/v1/euros/oficial", {}, 6000);
        const jsonEur = await resEur.json();
        if (jsonEur && jsonEur.promedio) eurFound = parseFloat(jsonEur.promedio) || 0;
      } catch(e2) {}
    }

    if (!binanceFound) {
      try {
        const resBin = await fetchWithTimeout("https://ve.dolarapi.com/v1/dolares/paralelo", {}, 6000);
        const jsonBin = await resBin.json();
        if (jsonBin && jsonBin.promedio) binanceFound = parseFloat(jsonBin.promedio) || 0;
      } catch(e3) {}
    }

    if (usdFound > 0) {
      appData.config.Tasa_USD_BCV = parseFloat(usdFound).toFixed(2);
      const inpUsd = document.getElementById("inputRateUsdBcv");
      if (inpUsd) inpUsd.value = appData.config.Tasa_USD_BCV;
    }

    if (eurFound > 0) {
      appData.config.Tasa_EUR_BCV = parseFloat(eurFound).toFixed(2);
      const inpEur = document.getElementById("inputRateEurBcv");
      if (inpEur) inpEur.value = appData.config.Tasa_EUR_BCV;
    }

    if (binanceFound > 0) {
      // Retener ediciones previas si no difiere demasiado o aplicar si está en 0
      appData.config.Tasa_Binance = parseFloat(binanceFound).toFixed(2);
      appData.config.Tasa_Efectivo_USDT = appData.config.Tasa_Binance;
      const inpUsdt = document.getElementById("inputRateUsdt");
      if (inpUsdt) inpUsdt.value = appData.config.Tasa_Binance;
    }

    updateSummaryPills();
    renderDashboard();
    debouncedSaveConfig();

    if (usdFound > 0 || eurFound > 0) {
      showToast(`Tasas actualizadas: USD BCV = ${appData.config.Tasa_USD_BCV} Bs | EUR BCV = ${appData.config.Tasa_EUR_BCV} Bs | Binance = ${appData.config.Tasa_Binance} Bs`, "success");
    } else {
      showToast("⚠️ Sin conexión a servidores cambiarios. Manteniendo tasas actuales.", "warning");
    }

  } catch (err) {
    showToast("⚠️ No se pudo consultar la tasa cambiaria. Manteniendo valores guardados.", "warning");
  } finally {
    if (btn) {
      btn.innerHTML = `<span>🌐</span> Sincronizar BCV`;
      btn.disabled = false;
    }
  }
}

// ==========================================
// Cloud Google Sheets Sync
// ==========================================
let lastCloudErrorAlerted = null;

// Helper: Fetch con límite estricto de timeout (14s para Google Apps Script)
async function fetchWithTimeout(url, options = {}, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado. Google Apps Script tardó en responder. Revisa que el script esté publicado como 'Cualquiera' o presiona nuevamente para reintentar.");
    }
    throw err;
  }
}

// Cargar configuración de la nube desde localStorage o default
function fetchCloudConfig() {
  try {
    const cachedUrl = localStorage.getItem("google_sheets_url");
    const cachedViewUrl = localStorage.getItem("google_sheets_view_url");
    if (cachedUrl) cloudConfig.google_sheets_url = cachedUrl;
    if (cachedViewUrl) cloudConfig.google_sheets_view_url = cachedViewUrl;
  } catch (e) {}

  if (!cloudConfig.google_sheets_url) cloudConfig.google_sheets_url = DEFAULT_GAS_URL;
  if (!cloudConfig.google_sheets_view_url) cloudConfig.google_sheets_view_url = DEFAULT_GAS_VIEW_URL;
  updateCloudUI();
}

function fetchCloudStatus(silent = true) {
  const hasUrl = Boolean(cloudConfig && cloudConfig.google_sheets_url && cloudConfig.google_sheets_url.trim().startsWith("http"));
  if (hasUrl) {
    updateCloudUI({ status: "synced", message: "Conectado a Google Sheets en tiempo real" });
  } else {
    updateCloudUI({ status: "offline", message: "Modo Local Autónomo" });
  }
}

function notifyCloudSyncStart() {
  if (cloudConfig && cloudConfig.google_sheets_url && cloudConfig.google_sheets_url.trim().startsWith("http")) {
    const headerBadge = document.getElementById("cloudStatusBadge");
    const headerIcon = document.getElementById("cloudStatusIcon");
    const headerText = document.getElementById("cloudStatusText");
    if (headerBadge) headerBadge.className = "summary-pill cloud-pill cloud-syncing";
    if (headerIcon) headerIcon.textContent = "🟡";
    if (headerText) headerText.textContent = "Sincronizando...";
    setTimeout(() => {
      fetchCloudStatus(false);
    }, 2000);
  }
}

function updateCloudUI(statusData) {
  const inputUrl = document.getElementById("inputGoogleSheetsUrl");
  const inputView = document.getElementById("inputGoogleSheetsViewUrl");
  const badgeState = document.getElementById("cloudConnectionStateText");
  const headerBadge = document.getElementById("cloudStatusBadge");
  const headerIcon = document.getElementById("cloudStatusIcon");
  const headerText = document.getElementById("cloudStatusText");
  const btnOpen = document.getElementById("btnOpenGoogleSheet");

  // Mantener inputs siempre sincronizados con cloudConfig o localStorage
  let effectiveUrl = (cloudConfig.google_sheets_url || "").trim();
  let effectiveViewUrl = (cloudConfig.google_sheets_view_url || "").trim();
  try {
    if (!effectiveUrl) effectiveUrl = (localStorage.getItem("google_sheets_url") || "").trim();
    if (!effectiveViewUrl) effectiveViewUrl = (localStorage.getItem("google_sheets_view_url") || "").trim();
  } catch (e) {}

  if (inputUrl && effectiveUrl && !inputUrl.value) {
    inputUrl.value = effectiveUrl;
  }
  if (inputView && effectiveViewUrl && !inputView.value) {
    inputView.value = effectiveViewUrl;
  }

  const hasCloud = !!(effectiveUrl && effectiveUrl.startsWith("http"));

  if (!hasCloud) {
    if (headerBadge) {
      headerBadge.className = "summary-pill cloud-pill cloud-offline";
      headerBadge.title = "Modo autónomo local (Configura Google Sheets en ⚙️)";
    }
    if (headerIcon) headerIcon.textContent = "⚪";
    if (headerText) headerText.textContent = "Modo Local";
    if (badgeState) {
      badgeState.textContent = "Modo Local Autónomo";
      badgeState.style.background = "#F1F1F4";
      badgeState.style.color = "#636366";
    }
    if (btnOpen) btnOpen.style.display = "none";
    return;
  }

  if (btnOpen) {
    if (effectiveViewUrl && effectiveViewUrl.startsWith("http")) {
      btnOpen.href = effectiveViewUrl;
      btnOpen.style.display = "inline-flex";
    } else {
      btnOpen.style.display = "none";
    }
  }

  const st = statusData ? statusData.status : "synced";
  const msg = statusData ? (statusData.message || statusData.last_error || "") : "Conectado a Google Sheets en tiempo real";

  if (st === "syncing") {
    if (headerBadge) {
      headerBadge.className = "summary-pill cloud-pill cloud-syncing";
      headerBadge.title = "Sincronizando cambios con Google Sheets...";
    }
    if (headerIcon) headerIcon.textContent = "🟡";
    if (headerText) headerText.textContent = "Sincronizando...";
    if (badgeState) {
      badgeState.textContent = "🟡 Sincronizando con Google Sheets...";
      badgeState.style.background = "#FFF8E6";
      badgeState.style.color = "#B26A00";
    }
  } else if (st === "error") {
    if (headerBadge) {
      headerBadge.className = "summary-pill cloud-pill cloud-error";
      headerBadge.title = msg || "Error al conectar con Google Sheets. Datos guardados en Excel local.";
    }
    if (headerIcon) headerIcon.textContent = "🔴";
    if (headerText) headerText.textContent = "Error en Nube";
    if (badgeState) {
      badgeState.textContent = msg ? `🔴 Error: ${msg}` : "🔴 Error al conectar con Google Sheets";
      badgeState.style.background = "#FDF0EE";
      badgeState.style.color = "#C0392B";
    }
  } else {
    // synced / idle
    if (headerBadge) {
      headerBadge.className = "summary-pill cloud-pill cloud-synced";
      headerBadge.title = msg || "Conectado y sincronizado con Google Sheets en tiempo real";
    }
    if (headerIcon) headerIcon.textContent = "🟢";
    if (headerText) headerText.textContent = "Nube Sincronizada";
    if (badgeState) {
      badgeState.textContent = "🟢 Conectado a Google Sheets";
      badgeState.style.background = "#E8F8EE";
      badgeState.style.color = "#1B8738";
    }
  }
}

async function connectAndSyncCloud() {
  const inputUrl = document.getElementById("inputGoogleSheetsUrl");
  const inputView = document.getElementById("inputGoogleSheetsViewUrl");
  const url = (inputUrl ? inputUrl.value : "").trim();
  const viewUrl = (inputView ? inputView.value : "").trim();

  // 1. Validación Automática del Formato del URL
  if (url) {
    const isDriveView = url.includes("docs.google.com/spreadsheets") || 
                        url.includes("/edit") || 
                        url.includes("usp=sharing") || 
                        url.includes("drive.google.com");
    if (isDriveView) {
      const msg = "⚠️ Estás pegando un enlace de visualización de Google Drive. Debes pegar la URL de la Aplicación Web que termina en /exec obtenida al Implementar en Apps Script";
      showToast(msg, "error");
      if (inputView && !inputView.value) {
        inputView.value = url;
        try {
          localStorage.setItem("google_sheets_view_url", url);
        } catch(e) {}
        cloudConfig.google_sheets_view_url = url;
      }
      if (inputUrl) {
        inputUrl.focus();
        inputUrl.style.borderColor = "#E74C3C";
        setTimeout(() => { inputUrl.style.borderColor = ""; }, 4000);
      }
      updateCloudUI({ status: "error", message: msg });
      return;
    }

    if (!url.startsWith("https://script.google.com/") || !url.endsWith("/exec")) {
      const msg = "⚠️ La URL de la Web App debe comenzar con 'https://script.google.com/' y terminar en '/exec'. Obtenla en Extensiones -> Apps Script -> Implementar -> Aplicación web.";
      showToast(msg, "error");
      if (inputUrl) {
        inputUrl.focus();
        inputUrl.style.borderColor = "#E74C3C";
        setTimeout(() => { inputUrl.style.borderColor = ""; }, 4000);
      }
      updateCloudUI({ status: "error", message: msg });
      return;
    }
  }

  // 2. Guardar de inmediato en localStorage y memoria de forma permanente
  try {
    localStorage.setItem("google_sheets_url", url);
    localStorage.setItem("google_sheets_view_url", viewUrl);
  } catch (e) {}
  cloudConfig.google_sheets_url = url;
  cloudConfig.google_sheets_view_url = viewUrl;

  const btn = document.getElementById("btnConnectCloud");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳</span> Conectando y Descargando...`;
  }

  const headerIcon = document.getElementById("cloudStatusIcon");
  const headerText = document.getElementById("cloudStatusText");
  const headerBadge = document.getElementById("cloudStatusBadge");
  if (headerBadge) headerBadge.className = "summary-pill cloud-pill cloud-syncing";
  if (headerIcon) headerIcon.textContent = "🟡";
  if (headerText) headerText.textContent = "Sincronizando...";

  let isConnected = false;
  let responseMsg = "";

  try {
    if (url) {
      const ok = await syncFromGASDirect();
      if (ok) {
        isConnected = true;
        updateCloudUI({ status: "synced", message: "Conectado a Google Sheets en tiempo real" });
        setTimeout(() => {
          window.closeConfigModal();
        }, 750);
      } else {
        responseMsg = "No se recibieron datos válidos de Google Apps Script";
      }
    } else {
      showToast("Configuración guardada en almacenamiento del navegador", "success");
      updateCloudUI({ status: "offline", message: "Modo Local Autónomo" });
    }
  } catch (err) {
    responseMsg = err.message || "Error al conectar con la Web App de Google Apps Script";
    showToast("⚠️ " + responseMsg, "error");
  } finally {
    // Liberar interfaz al instante
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>☁️</span> Conectar y Sincronizar Nube`;
    }
    if (url) {
      if (isConnected) {
        updateCloudUI({ status: "synced", message: "Conectado a Google Sheets en tiempo real" });
      } else {
        updateCloudUI({ status: "error", message: responseMsg || "Comprueba la configuración de Google Apps Script" });
      }
    }
  }
}

async function triggerCloudSyncHeader() {
  let effectiveUrl = (cloudConfig.google_sheets_url || "").trim();
  try {
    if (!effectiveUrl) effectiveUrl = (localStorage.getItem("google_sheets_url") || "").trim();
  } catch (e) {}

  if (!effectiveUrl) {
    showToast("Configura la URL de Google Sheets en ⚙️ Configurar Tasas y Meta", "warning");
    window.openConfigModal(true);
    return;
  }

  const btnSync = document.getElementById("btnSyncCloudHeader");
  if (btnSync) {
    btnSync.style.transform = "rotate(180deg)";
    btnSync.style.transition = "transform 0.4s ease";
  }

  try {
    await syncFromGASDirect();
  } catch (err) {
    showToast("⚠️ Error al sincronizar con Google Sheets: " + err.message, "error");
  } finally {
    if (btnSync) {
      setTimeout(() => {
        btnSync.style.transform = "";
      }, 300);
    }
  }
}

// Helper: Calculate item costs in client (Motor de 3 Tasas y Paridad Oficial)
function calcItemCosts(tipoCobro, cant, precio, moneda, forma, inv) {
  precio = parseFloat(precio) || 0;
  cant = parseFloat(cant) || 1;
  inv = parseFloat(inv) || parseFloat(appData.config?.Invitados_Base) || 100;
  const bcvUsd = parseFloat(appData.config?.Tasa_USD_BCV) || 45.5;
  const bcvEur = parseFloat(appData.config?.Tasa_EUR_BCV) || 49.8;
  const usdt = parseFloat(appData.config?.Tasa_Binance || appData.config?.Tasa_Efectivo_USDT) || 54.0;

  let mult = (tipoCobro === "Por Invitado") ? (inv * (cant || 1)) : (cant || 1);

  let cNom = 0, cReal = 0, cVes = 0;

  if ((moneda === "USD" && (forma === "Bs a tasa BCV" || forma === "Bs a tasa Dólar BCV" || forma === "Dólar BCV" || forma === "Transferencia BCV")) || forma === "Bs a tasa Dólar BCV") {
    cVes = precio * mult * bcvUsd;
    cNom = precio * mult;
    cReal = usdt > 0 ? cVes / usdt : cNom;
  } else if ((moneda === "EUR" && (forma === "Bs a tasa BCV" || forma === "Bs a tasa Euro BCV" || forma === "Euro BCV")) || forma === "Bs a tasa Euro BCV") {
    cVes = precio * mult * bcvEur;
    cNom = bcvUsd > 0 ? cVes / bcvUsd : (precio * mult);
    cReal = usdt > 0 ? cVes / usdt : cNom;
  } else if (forma === "USD Efectivo (Billetes)" || forma === "USDT / Binance" || forma === "Binance USDT" || forma === "Efectivo" || forma === "Zelle") {
    if (moneda === "USD") {
      cReal = precio * mult;
      cNom = cReal;
      cVes = cReal * usdt;
    } else if (moneda === "EUR") {
      cReal = (precio * mult) * (bcvEur / bcvUsd);
      cNom = cReal;
      cVes = cReal * usdt;
    } else {
      cVes = precio * mult;
      cReal = usdt > 0 ? cVes / usdt : 0;
      cNom = bcvUsd > 0 ? cVes / bcvUsd : 0;
    }
  } else if (moneda === "VES") {
    cVes = precio * mult;
    cNom = bcvUsd > 0 ? cVes / bcvUsd : 0;
    cReal = usdt > 0 ? cVes / usdt : 0;
  } else {
    cNom = precio * mult;
    cVes = cNom * bcvUsd;
    cReal = usdt > 0 ? cVes / usdt : cNom;
  }

  const cEur = bcvEur > 0 ? cVes / bcvEur : 0;
  return {
    cNom: Math.round(cNom * 100) / 100,
    cReal: Math.round(cReal * 100) / 100,
    cBinance: Math.round(cReal * 100) / 100,
    cVes: Math.round(cVes * 100) / 100,
    cEur: Math.round(cEur * 100) / 100
  };
}

// PESTAÑA 1: DASHBOARD
function renderDashboard() {
  populateScenarioDropdowns();

  // Find rows for active scenario
  const scenarioRows = appData.escenarios_rows.filter(r => r.ID_Escenario === activeScenarioId);
  const guests = parseFloat(appData.config.Invitados_Base) || 100;
  const colchon = (appData.config.Aplicar_Colchon_Imprevistos || "").toUpperCase() === "SI" ? 1.15 : 1.0;

  let totalReal = 0;
  let totalNom = 0;
  let totalVes = 0;
  let totalEur = 0;

  let cashUsd = 0;
  let usdtTotal = 0;
  let bcvVesTotal = 0;
  let marginalGuestReal = 0;
  let salonComidaReal = 0;

  scenarioRows.forEach(row => {
    const item = appData.catalogo.find(c => c.ID_Item === row.ID_Item) || row;
    const rowQty = parseFloat(row.Cantidad_Escenario || row.Cantidad_Unidades || item.Cantidad_Unidades || 1) || 1;
    const costs = calcItemCosts(
      item.Tipo_Cobro || row.Tipo_Cobro,
      rowQty,
      item.Precio_Unitario_Cotizado || row.Precio_Unitario_Cotizado || row.Precio_Unitario,
      item.Moneda_Cotizada || row.Moneda_Cotizada,
      item.Forma_Pago_Exigida || row.Forma_Pago_Exigida,
      guests
    );

    totalReal += costs.cReal;
    totalNom += costs.cNom;
    totalVes += costs.cVes;
    totalEur += costs.cEur;

    // Arqueo de caja
    const forma = item.Forma_Pago_Exigida || row.Forma_Pago_Exigida;
    if (forma === "USD Efectivo (Billetes)") {
      cashUsd += costs.cReal;
    } else if (forma === "USDT / Binance") {
      usdtTotal += costs.cReal;
    } else if (forma === "Bs a tasa BCV") {
      bcvVesTotal += costs.cVes;
    }

    // 1 Silla más (Marginal)
    if ((item.Tipo_Cobro || row.Tipo_Cobro) === "Por Invitado") {
      const singleGuest = calcItemCosts("Por Invitado", 1, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, 1);
      marginalGuestReal += singleGuest.cReal;
    }

    // Peso Salón + Comida
    const cat = (item.Categoria || row.Categoria || "").toLowerCase();
    if (cat.includes("espacio") || cat.includes("salón") || cat.includes("salon") || cat.includes("alimento") || cat.includes("catering") || cat.includes("bebida")) {
      salonComidaReal += costs.cReal;
    }
  });

  // Apply Colchón if active
  totalReal *= colchon;
  totalNom *= colchon;
  totalVes *= colchon;
  totalEur *= colchon;

  // Semáforo calculations
  const meta = parseFloat(appData.config.Presupuesto_Meta_USD) || 2500;
  const techo = parseFloat(appData.config.Presupuesto_Techo_USD) || 3200;

  document.getElementById("dashTotalUsdReal").textContent = formatUSD(totalReal);
  document.getElementById("dashTotalUsdNominal").textContent = formatUSD(totalNom);
  document.getElementById("dashTotalVes").textContent = formatVES(totalVes);
  document.getElementById("dashTotalEur").textContent = formatEUR(totalEur);

  const badge = document.getElementById("semaforoBadge");
  const fill = document.getElementById("progressFill");
  const diffNotice = document.getElementById("dashDifferenceNotice");

  // Visual Gauge percentage (0% to 125% of techo)
  const maxScale = Math.max(techo * 1.25, totalReal * 1.1, 100);
  const fillPct = Math.min(100, Math.max(2, (totalReal / maxScale) * 100));
  const metaPct = Math.min(95, (meta / maxScale) * 100);
  const techoPct = Math.min(98, (techo / maxScale) * 100);

  fill.style.width = fillPct + "%";
  document.getElementById("markerMeta").style.left = metaPct + "%";
  document.getElementById("markerMetaLabel").textContent = "Meta: " + formatUSD(meta);
  document.getElementById("markerTecho").style.left = techoPct + "%";
  document.getElementById("markerTechoLabel").textContent = "Techo: " + formatUSD(techo);

  fill.className = "progress-fill";
  badge.className = "semaforo-badge";

  if (totalReal <= meta) {
    badge.classList.add("verde");
    fill.classList.add("verde");
    document.getElementById("semaforoText").textContent = "Dentro del Presupuesto Meta Ideal";
    const saving = meta - totalReal;
    diffNotice.style.color = "#1B8738";
    diffNotice.textContent = `Ahorro vs Meta Ideal: ${formatUSD(saving)}`;
  } else if (totalReal <= techo) {
    badge.classList.add("amarillo");
    fill.classList.add("amarillo");
    document.getElementById("semaforoText").textContent = "Zona Intermedia (Sobre Meta, Bajo Techo)";
    const overMeta = totalReal - meta;
    const underTecho = techo - totalReal;
    diffNotice.style.color = "#B26A00";
    diffNotice.textContent = `+$${overMeta.toFixed(2)} sobre la meta | Aún te sobran ${formatUSD(underTecho)} de margen`;
  } else {
    badge.classList.add("rojo");
    fill.classList.add("rojo");
    document.getElementById("semaforoText").textContent = "Sobregiro Presupuestario";
    const overTecho = totalReal - techo;
    const overPct = ((overTecho / techo) * 100).toFixed(1);
    diffNotice.style.color = "#FF3B30";
    diffNotice.textContent = `⚠️ Excedido por ${formatUSD(overTecho)} (+${overPct}% sobre el techo máximo)`;
  }

  // 5 KPIs
  // KPI 1: Costo Total por Invitado
  const perGuestReal = guests > 0 ? totalReal / guests : 0;
  const perGuestVes = guests > 0 ? totalVes / guests : 0;
  document.getElementById("kpi1Val").textContent = formatUSD(perGuestReal);
  document.getElementById("kpi1Sub").textContent = `Equivalente a ${formatVES(perGuestVes)} por persona`;

  // KPI 2: 1 Silla Más (Marginal)
  document.getElementById("kpi2Val").textContent = formatUSD(marginalGuestReal);

  // KPI 3: Arqueo de Caja
  document.getElementById("kpi3Val").textContent = formatUSD(cashUsd);
  document.getElementById("kpi3Sub").textContent = `Billetes: ${formatUSD(cashUsd)} | USDT: ${formatUSD(usdtTotal)} | Bs BCV: ${formatVES(bcvVesTotal)}`;

  // KPI 4: Ahorro Brecha BCV
  const ahorroBrecha = Math.max(0, totalNom - totalReal);
  document.getElementById("kpi4Val").textContent = formatUSD(ahorroBrecha);
  const ahorroPct = totalNom > 0 ? ((ahorroBrecha / totalNom) * 100).toFixed(1) : "0";
  document.getElementById("kpi4Sub").textContent = `${ahorroPct}% de ahorro por pagar a tasa oficial BCV`;

  // KPI 5: Salón + Comida
  const pctPesados = totalReal > 0 ? Math.round((salonComidaReal / totalReal) * 100) : 0;
  const kpi5Val = document.getElementById("kpi5Val");
  kpi5Val.textContent = pctPesados + "%";
  const kpi5Icon = document.getElementById("kpi5Icon");
  if (pctPesados > 65) {
    kpi5Icon.textContent = "⚠️";
    kpi5Val.style.color = "#FF9500";
    document.getElementById("kpi5Sub").textContent = "¡Atención! Salón y Comida superan el 65% recomendado.";
  } else {
    kpi5Icon.textContent = "🍽️";
    kpi5Val.style.color = "#1D1D1F";
    document.getElementById("kpi5Sub").textContent = "Distribución equilibrada (<65% del presupuesto total).";
  }

  // Render Sugerencias de Optimización
  renderSmartSuggestions(scenarioRows, guests, totalReal, techo, marginalGuestReal);
}

function renderSmartSuggestions(scenarioRows, guests, totalReal, techo, marginalGuestReal) {
  const container = document.getElementById("suggestionsContainer");
  container.innerHTML = "";

  // 1. Viabilidad por Invitados
  if (totalReal > techo && marginalGuestReal > 0) {
    const exceso = totalReal - techo;
    const invitadosReducir = Math.ceil(exceso / marginalGuestReal);
    const card = document.createElement("div");
    card.className = "suggestion-card";
    card.innerHTML = `
      <div class="suggestion-icon">📌</div>
      <div class="suggestion-content">
        <div class="suggestion-title">Ajuste de Viabilidad por Lista de Invitados</div>
        <div class="suggestion-text">
          Para entrar dentro de tu Techo Máximo de <strong>${formatUSD(techo)}</strong> sin cambiar ningún proveedor, necesitas reducir la lista en <strong>${invitadosReducir} invitados</strong> (ahorras <strong>${formatUSD(marginalGuestReal)}</strong> por cada invitado menos).
        </div>
      </div>
    `;
    container.appendChild(card);
  }

  // 2. Reemplazos Puntuales Más Económicos
  let foundReplacements = 0;
  scenarioRows.forEach(row => {
    const currentItem = appData.catalogo.find(c => c.ID_Item === row.ID_Item);
    if (!currentItem || !currentItem.Producto_Comparable) return;

    const currentCost = calcItemCosts(
      currentItem.Tipo_Cobro, currentItem.Cantidad_Unidades, currentItem.Precio_Unitario_Cotizado,
      currentItem.Moneda_Cotizada, currentItem.Forma_Pago_Exigida, guests
    ).cReal;

    // Search catalog for same Producto_Comparable with lower Real USD
    const alternatives = appData.catalogo.filter(c => 
      c.Producto_Comparable === currentItem.Producto_Comparable &&
      c.ID_Item !== currentItem.ID_Item
    );

    alternatives.forEach(alt => {
      const altCost = calcItemCosts(
        alt.Tipo_Cobro, alt.Cantidad_Unidades, alt.Precio_Unitario_Cotizado,
        alt.Moneda_Cotizada, alt.Forma_Pago_Exigida, guests
      ).cReal;

      if (altCost < currentCost) {
        const ahorro = currentCost - altCost;
        const ahorroPct = totalReal > 0 ? ((ahorro / totalReal) * 100).toFixed(1) : "0";
        foundReplacements++;

        const card = document.createElement("div");
        card.className = "suggestion-card";
        card.innerHTML = `
          <div class="suggestion-icon">💡</div>
          <div class="suggestion-content">
            <div class="suggestion-title">Oportunidad de Ahorro: ${escapeHtml(currentItem.Producto_Comparable)}</div>
            <div class="suggestion-text">
              Si cambias a <strong>${escapeHtml(currentItem.Nombre_Proveedor)}</strong> por <strong>${escapeHtml(alt.Nombre_Proveedor)}</strong>, ahorras <strong>${formatUSD(ahorro)}</strong> en Costo Binance (-${ahorroPct}% del presupuesto total).
            </div>
          </div>
        `;
        container.appendChild(card);
      }
    });
  });

  if (foundReplacements === 0 && totalReal <= techo) {
    const card = document.createElement("div");
    card.className = "suggestion-card";
    card.innerHTML = `
      <div class="suggestion-icon">✅</div>
      <div class="suggestion-content">
        <div class="suggestion-title">Presupuesto en Rango Óptimo</div>
        <div class="suggestion-text">
          Tu presupuesto actual cuenta con una selección muy competitiva de proveedores dentro de tus límites financieros ideales.
        </div>
      </div>
    `;
    container.appendChild(card);
  }
}

// Helper: Obtener Presupuestos Únicos Reales
function getUniqueScenarios() {
  const list = [];
  const map = new Map();
  if (appData && appData.escenarios_rows) {
    appData.escenarios_rows.forEach(r => {
      const id = r.ID_Escenario;
      if (id && !map.has(id)) {
        map.set(id, true);
        list.push({
          id: id,
          name: r.Nombre_Escenario || id
        });
      }
    });
  }
  return list;
}

// Populate Scenario Dropdowns exclusivamente con datos reales
function populateScenarioDropdowns() {
  const uniqueScenarios = getUniqueScenarios();

  const selDash = document.getElementById("selectActiveScenario");
  const selComp1 = document.getElementById("selectCompare1");
  const selComp2 = document.getElementById("selectCompare2");
  const selComp3 = document.getElementById("selectCompare3");

  const updateSelect = (sel, isOptional, defaultIdx) => {
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = "";

    if (isOptional) {
      const optNone = document.createElement("option");
      optNone.value = "";
      optNone.textContent = "-- Ninguno (Comparar 2) --";
      sel.appendChild(optNone);
    }

    if (uniqueScenarios.length === 0) {
      if (!isOptional) {
        const optEmpty = document.createElement("option");
        optEmpty.value = "";
        optEmpty.textContent = "-- Sin presupuestos creados --";
        sel.appendChild(optEmpty);
      }
      return;
    }

    uniqueScenarios.forEach(sc => {
      const opt = document.createElement("option");
      opt.value = sc.id;
      opt.textContent = `${sc.name} (${sc.id})`;
      sel.appendChild(opt);
    });

    if (currentVal && uniqueScenarios.some(s => s.id === currentVal)) {
      sel.value = currentVal;
    } else if (defaultIdx !== undefined && uniqueScenarios[defaultIdx]) {
      sel.value = uniqueScenarios[defaultIdx].id;
    } else if (uniqueScenarios.length > 0 && !isOptional) {
      sel.value = uniqueScenarios[0].id;
    }
  };

  updateSelect(selDash, false, 0);
  updateSelect(selComp1, false, 0);
  updateSelect(selComp2, false, uniqueScenarios.length > 1 ? 1 : 0);
  updateSelect(selComp3, true, undefined);
}

// ==========================================
// PESTAÑA: LISTA DE INVITADOS & ASISTENCIA
// ==========================================
function renderGuestsTab() {
  const rawList = appData.invitados || [];
  // Asegurar que cada invitado esté normalizado y blindado contra nulos
  const list = rawList.map(normalizeGuest).filter(Boolean);
  appData.invitados = list;

  // Calculate Mini KPIs
  let totalTitulares = list.length;
  let totalAcompanantes = 0;
  let confirmedTotal = 0;
  let pendingCount = 0;
  let declinedCount = 0;
  let dietCount = 0;

  list.forEach(inv => {
    const acomp = parseInt(inv.Acompanantes !== undefined ? inv.Acompanantes : inv.Acompanantes_Adicionales, 10) || 0;
    totalAcompanantes += acomp;
    const headcount = 1 + acomp;
    const st = String(inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente").trim();

    if (st === "Confirmado") {
      confirmedTotal += headcount;
    } else if (st === "Declinado") {
      declinedCount += headcount;
    } else {
      pendingCount += headcount;
    }

    const restr = String(inv.Restricciones_ || inv.Restricciones_Alimentarias || "").trim().toLowerCase();
    if (restr && restr !== "ninguna" && restr !== "no" && restr !== "ninguno" && restr !== "n/a") {
      dietCount += headcount;
    }
  });

  const grandTotal = totalTitulares + totalAcompanantes;

  const elTot = document.getElementById("kpiGuestsTotal");
  if (elTot) elTot.textContent = grandTotal;
  const elDet = document.getElementById("kpiGuestsDetail");
  if (elDet) elDet.textContent = `${totalTitulares} titulares + ${totalAcompanantes} +1`;
  const elConf = document.getElementById("kpiGuestsConfirmed");
  if (elConf) elConf.textContent = confirmedTotal;
  const elPend = document.getElementById("kpiGuestsPending");
  if (elPend) elPend.textContent = pendingCount;
  const elDecl = document.getElementById("kpiGuestsDeclined");
  if (elDecl) elDecl.textContent = declinedCount;
  const elDiet = document.getElementById("kpiGuestsDiet");
  if (elDiet) elDiet.textContent = dietCount;

  // Renderizado según modo de vista (Regular vs Agrupada por Mesas)
  renderGuestsContent(list);
}

// Variables de estado y funciones de soporte para el Módulo de Invitados y Mesas
let isTableGroupedView = false;

function cleanMesaName(mesa) {
  if (!mesa) return "";
  let clean = String(mesa).trim();
  if (/^mesa\s+principal/i.test(clean) || /^principal$/i.test(clean)) {
    return "Principal";
  }
  if (/^mesa\s+(\d+)$/i.test(clean)) {
    return clean.replace(/^mesa\s+/i, "");
  }
  if (/^mesa\s+/i.test(clean)) {
    return clean.replace(/^mesa\s+/i, "");
  }
  return clean;
}

function getTableOptionsHtml(currentTable) {
  const rawCurrent = (currentTable || "").trim();
  const cleanedCurrent = cleanMesaName(rawCurrent);

  const tables = [
    { val: "", label: "-- Sin asignar --" },
    { val: "Principal", label: "👑 Principal" }
  ];
  for (let i = 1; i <= 25; i++) {
    tables.push({ val: String(i), label: String(i) });
  }

  const matched = tables.find(t => t.val === cleanedCurrent || t.val === rawCurrent);
  const isCustom = cleanedCurrent && !matched;

  let html = "";
  tables.forEach(t => {
    const isSelected = matched ? (t.val === matched.val) : false;
    html += `<option value="${escapeHtml(t.val)}" ${isSelected ? "selected" : ""}>${escapeHtml(t.label)}</option>`;
  });
  if (isCustom) {
    html += `<option value="${escapeHtml(cleanedCurrent)}" selected>📍 ${escapeHtml(cleanedCurrent)}</option>`;
  }
  html += `<option value="__custom__">+ Otra personalizada...</option>`;
  return html;
}

function onGuestTableChange(guestId, selectedValue) {
  let finalTable = selectedValue;
  if (selectedValue === "__custom__") {
    const customName = prompt("Escribe el número o nombre de la nueva mesa (Ej: 26, VIP, Terraza):");
    if (customName && customName.trim()) {
      finalTable = cleanMesaName(customName.trim());
    } else {
      renderGuestsTab();
      return;
    }
  } else {
    finalTable = cleanMesaName(finalTable);
  }

  updateGuestInline(guestId, "Mesa_Asignada", finalTable);
}

// Actualización en línea de invitados con sincronización directa
async function updateGuestInline(guestId, field, value) {
  let finalValue = value;
  if (field === "Mesa_Asignada" && value === "__custom__") {
    const customName = prompt("Escribe el número o nombre de la nueva mesa (Ej: 26, VIP, Terraza):");
    if (customName && customName.trim()) {
      finalValue = cleanMesaName(customName.trim());
    } else {
      renderGuestsTab();
      return;
    }
  } else if (field === "Mesa_Asignada") {
    finalValue = cleanMesaName(finalValue);
  } else if (field === "Acompanantes_Adicionales") {
    const n = parseInt(value, 10);
    finalValue = isNaN(n) ? 0 : Math.max(0, n);
  }

  const guest = (appData.invitados || []).find(g => String(g.ID_Invitado || "").trim() === String(guestId || "").trim());
  if (!guest) return;

  guest[field] = finalValue;
  if (field === "Nombre_Completo") guest.Nombre_Comp = finalValue;
  if (field === "Estado_Confirmacion") guest.Estado_Confirm = finalValue;
  if (field === "Restricciones_Alimentarias") guest.Restricciones_ = finalValue;
  if (field === "Acompanantes_Adicionales") guest.Acompanantes = finalValue;

  syncAppDataToLocalStorage();

  if (field === "Estado_Confirmacion" || field === "Acompanantes_Adicionales") {
    renderDashboard();
    updateSummaryPills();
  }
  if (field === "Mesa_Asignada" && isTableGroupedView) {
    renderGuestsTab();
  }

  showToast("Dato de invitado guardado", "success", 1100);
  await postDirectToGAS("save_guest", "guest", guest);
}
window.updateGuestInline = updateGuestInline;

function toggleGuestGroupTables() {
  isTableGroupedView = !isTableGroupedView;
  const btn = document.getElementById("btnToggleGroupTables");
  const tableCont = document.getElementById("guestsTableContainer");
  const groupCont = document.getElementById("guestsTableGroupsContainer");

  if (btn) {
    btn.innerHTML = isTableGroupedView
      ? `<span>📋</span> Vista Tabla Regular`
      : `<span>🪑</span> Agrupar por Mesas`;
  }

  if (tableCont && groupCont) {
    if (isTableGroupedView) {
      tableCont.style.display = "none";
      groupCont.style.display = "block";
    } else {
      tableCont.style.display = "block";
      groupCont.style.display = "none";
    }
  }
  renderGuestsTab();
}

function populateGuestTableFilterDropdown(list) {
  const sel = document.getElementById("filterGuestTable");
  if (!sel) return;
  const currentVal = sel.value;

  const existingTables = new Set();
  list.forEach(i => {
    const m = cleanMesaName(i.Mesa_Asignada);
    if (m) existingTables.add(m);
  });

  let html = `
    <option value="">Todas las Mesas</option>
    <option value="__none__">Sin Mesa Asignada</option>
    <option value="Principal">👑 Principal</option>
  `;
  for (let i = 1; i <= 25; i++) {
    html += `<option value="${i}">${i}</option>`;
  }
  existingTables.forEach(t => {
    if (t !== "Principal" && !t.match(/^\d+$/)) {
      html += `<option value="${escapeHtml(t)}">📍 ${escapeHtml(t)}</option>`;
    }
  });

  sel.innerHTML = html;
  if (currentVal) sel.value = currentVal;
}

function renderGuestsContent(list) {
  // Filter Table
  populateGuestTableFilterDropdown(list);
  const query = (document.getElementById("searchGuests")?.value || "").toLowerCase().trim();
  const stFilter = (document.getElementById("filterGuestStatus")?.value || "").trim();
  const roleFilter = (document.getElementById("filterGuestRole")?.value || "").trim();
  const tableFilter = (document.getElementById("filterGuestTable")?.value || "").trim();

  const tbody = document.getElementById("tbodyGuests");
  const groupCont = document.getElementById("guestsTableGroupsContainer");
  const tableCont = document.getElementById("guestsTableContainer");

  const filtered = list.filter(inv => {
    const nombre = String(inv.Nombre_Comp || inv.Nombre_Completo || "").toLowerCase();
    const tel = String(inv.Telefono || "").toLowerCase();
    const rol = String(inv.Rol_Cortejo || "").toLowerCase();
    const rest = String(inv.Restricciones_ || inv.Restricciones_Alimentarias || "").toLowerCase();
    const mesa = String(inv.Mesa_Asignada || "").toLowerCase();
    const notas = String(inv.Notas || "").toLowerCase();
    const st = String(inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente").trim();

    const matchQuery = !query ||
      nombre.includes(query) ||
      tel.includes(query) ||
      rol.includes(query) ||
      rest.includes(query) ||
      mesa.includes(query) ||
      notas.includes(query);

    const matchStatus = !stFilter || st === stFilter;
    const matchRole = !roleFilter || String(inv.Rol_Cortejo || "").trim() === roleFilter;
    const cleanInvTable = cleanMesaName(inv.Mesa_Asignada);
    const matchTable = !tableFilter || (tableFilter === "__none__" ? (!cleanInvTable) : cleanInvTable === cleanMesaName(tableFilter));
    return matchQuery && matchStatus && matchRole && matchTable;
  });

  // Si la vista agrupada por mesas está activa
  if (isTableGroupedView && groupCont) {
    if (tableCont) tableCont.style.display = "none";
    groupCont.style.display = "block";

    if (filtered.length === 0) {
      groupCont.innerHTML = `
        <div class="card" style="text-align:center; padding:36px; color:var(--text-secondary);">
          No se encontraron invitados con los filtros seleccionados.
        </div>
      `;
      return;
    }

    // Agrupar por mesa limpia
    const groups = {};
    filtered.forEach(inv => {
      const mesa = cleanMesaName(inv.Mesa_Asignada) || "Sin Asignar";
      if (!groups[mesa]) groups[mesa] = [];
      groups[mesa].push(inv);
    });

    // Ordenar mesas: Principal primero, luego números 1..25, luego personalizadas, luego Sin Asignar al final
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === "Principal") return -1;
      if (b === "Principal") return 1;
      if (a === "Sin Asignar") return 1;
      if (b === "Sin Asignar") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    let groupHtml = `<div class="table-groups-grid">`;
    sortedKeys.forEach(tableKey => {
      const guestsInTable = groups[tableKey];
      const isSinMesa = tableKey === "Sin Asignar";
      let totalTit = guestsInTable.length;
      let totalPlus = 0;
      guestsInTable.forEach(g => {
        totalPlus += parseInt(g.Acompanantes !== undefined ? g.Acompanantes : g.Acompanantes_Adicionales, 10) || 0;
      });
      const totalHeadcount = totalTit + totalPlus;
      const displayTitle = isSinMesa ? "Sin Mesa Asignada" : (tableKey === "Principal" ? "Mesa Principal" : "Mesa " + escapeHtml(tableKey));

      groupHtml += `
        <div class="table-group-card ${isSinMesa ? 'sin-mesa' : ''}">
          <div class="table-group-header">
            <div class="table-group-title">
              <span>${isSinMesa ? '⚠️' : (tableKey === 'Principal' ? '👑' : '🪑')}</span>
              <span>${displayTitle}</span>
            </div>
            <div class="table-group-badge ${isSinMesa ? 'badge-sin-mesa' : ''}">
              ${totalHeadcount} ${totalHeadcount === 1 ? 'persona' : 'personas'} (${totalTit} tit. + ${totalPlus} +1)
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px;">
      `;

      const rolOptions = ["Familia Novio", "Familia Novia", "Amigos Novio", "Amigos Novia", "Cortejo Novio", "Cortejo Novia", "Padrinos", "Proveedor / Staff", "Invitado"];
      const stOptions = ["Confirmado", "Pendiente", "Declinado"];

      guestsInTable.forEach(inv => {
        const nombreFinal = String(inv.Nombre_Comp || inv.Nombre_Completo || "").trim();
        const acompNum = parseInt(inv.Acompanantes !== undefined ? inv.Acompanantes : inv.Acompanantes_Adicionales, 10) || 0;
        const dietFinal = String(inv.Restricciones_ || inv.Restricciones_Alimentarias || "").trim();
        const currentRol = inv.Rol_Cortejo || "Familia Novio";
        const currentSt = String(inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente").trim();
        const guestPhotoUrl = getPhotoUrl(inv.Ruta_Foto);
        const thumbHtml = guestPhotoUrl ? `
          <img src="${escapeHtml(guestPhotoUrl)}" alt="Foto" class="table-guest-thumb thumbnail-clickable"
               onclick="openFullDetailModal('guest', '${escapeHtml(inv.ID_Invitado)}')"
               onerror="this.style.display='none';" />
        ` : `<span style="font-size:20px; line-height:1;">👤</span>`;

        groupHtml += `
          <div class="table-guest-item" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:10px; background:#FFFFFF; border:1px solid #E5E5EA; border-radius:10px; margin-bottom:6px;">
            <div style="display:flex; align-items:center; gap:8px; flex:1 1 220px; min-width:0;">
              ${thumbHtml}
              <div style="flex:1; min-width:0;">
                <input type="text" class="inline-table-input" value="${escapeHtml(nombreFinal)}" style="font-weight:700; font-size:13px; color:#1D1D1F;"
                       onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Nombre_Completo', this.value)" placeholder="Nombre del invitado" />
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; align-items:center;">
                  <select class="inline-table-select" style="font-size:11px; padding:2px 4px;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Rol_Cortejo', this.value)">
                    ${rolOptions.map(r => `<option value="${escapeHtml(r)}" ${r === currentRol ? "selected" : ""}>${escapeHtml(r)}</option>`).join("")}
                  </select>
                  <select class="inline-table-select" style="font-size:11px; padding:2px 4px; font-weight:700;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Estado_Confirmacion', this.value)">
                    ${stOptions.map(s => `<option value="${s}" ${s === currentSt ? "selected" : ""}>${s}</option>`).join("")}
                  </select>
                  <span style="font-size:11px; color:var(--text-secondary);">+1:</span>
                  <input type="number" min="0" max="15" class="inline-table-input-sm" value="${acompNum}" style="width:42px; font-size:11px; padding:2px 4px; text-align:center;"
                         onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Acompanantes_Adicionales', this.value)" title="Acompañantes adicionales" />
                  <input type="text" class="inline-table-input" value="${escapeHtml(dietFinal)}" placeholder="Dieta..." style="width:95px; font-size:11px; padding:2px 4px;"
                         onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Restricciones_Alimentarias', this.value)" />
                </div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
              <select class="inline-table-select" style="max-width:115px; font-size:11.5px; padding:3px 6px;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Mesa_Asignada', this.value)" title="Mover de mesa">
                ${getTableOptionsHtml(inv.Mesa_Asignada || "")}
              </select>
              <button class="btn btn-secondary mini-btn-icon" style="padding:4px 7px; font-size:11px;" onclick="openFullDetailModal('guest', '${escapeHtml(inv.ID_Invitado)}')" title="Ver ficha completa">🔍</button>
              <button class="btn btn-secondary mini-btn-icon" style="padding:4px 7px; font-size:11px;" onclick="editGuest('${escapeHtml(inv.ID_Invitado)}')" title="Editar modal">✏️</button>
              <button class="btn btn-danger mini-btn-icon" style="padding:4px 7px; font-size:11px;" onclick="deleteGuestAction('${escapeHtml(inv.ID_Invitado)}', '${escapeHtml(nombreFinal)}')" title="Borrar">🗑️</button>
            </div>
          </div>
        `;
      });

      groupHtml += `
          </div>
        </div>
      `;
    });
    groupHtml += `</div>`;
    groupCont.innerHTML = groupHtml;
    return;
  }

  // Vista Tabla Regular
  if (tableCont) tableCont.style.display = "block";
  if (groupCont) groupCont.style.display = "none";
  if (!tbody) return;
  tbody.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:36px; color:var(--text-secondary);">
          ${list.length === 0 ? "No hay invitados registrados todavía. Haz clic en <strong>+ Nuevo Invitado</strong> para comenzar." : "No se encontraron invitados con los filtros seleccionados."}
        </td>
      </tr>
    `;
    return;
  }

  const rolOptions = ["Familia Novio", "Familia Novia", "Amigos Novio", "Amigos Novia", "Cortejo Novio", "Cortejo Novia", "Padrinos", "Proveedor / Staff", "Invitado"];
  const stOptions = ["Confirmado", "Pendiente", "Declinado"];

  filtered.forEach(inv => {
    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid rgba(0,0,0,0.06)";

    const nombreFinal = String(inv.Nombre_Comp || inv.Nombre_Completo || "").trim();
    const currentRol = inv.Rol_Cortejo || "Familia Novio";
    const currentSt = String(inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente").trim();
    const acompNum = parseInt(inv.Acompanantes !== undefined ? inv.Acompanantes : inv.Acompanantes_Adicionales, 10) || 0;
    const rawDiet = String(inv.Restricciones_ || inv.Restricciones_Alimentarias || "").trim();
    const notasFinal = String(inv.Notas || "").trim();

    // WhatsApp link con manejo seguro garantizado de teléfono
    const tel = inv.Telefono !== undefined && inv.Telefono !== null ? String(inv.Telefono).trim() : "";
    let digits = tel.replace(/\D/g, "");
    if (digits.startsWith("0")) digits = "58" + digits.slice(1);
    else if (!digits.startsWith("58") && digits.length === 10) digits = "58" + digits;

    const waBtn = digits ? `
      <a href="https://wa.me/${digits}" target="_blank" class="btn btn-secondary" style="padding:2px 6px; font-size:11px; border-radius:8px; color:#128C7E; text-decoration:none;" title="Enviar WhatsApp">
        💬
      </a>
    ` : "";

    const guestPhotoUrl = getPhotoUrl(inv.Ruta_Foto);
    const guestThumbHtml = guestPhotoUrl ? `
      <img src="${escapeHtml(guestPhotoUrl)}" alt="Foto" class="thumbnail-clickable" style="width:34px; height:34px; object-fit:cover; border-radius:8px; border:1px solid #E5E5EA; cursor:pointer;"
           onclick="openFullDetailModal('guest', '${escapeHtml(inv.ID_Invitado)}')" title="Ver ficha completa"
           onerror="this.style.display='none';" />
    ` : `<span style="font-size:18px; color:#CCC;">👤</span>`;

    let rolSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:115px;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Rol_Cortejo', this.value)">`;
    rolOptions.forEach(r => {
      rolSelectHtml += `<option value="${escapeHtml(r)}" ${r === currentRol ? "selected" : ""}>${escapeHtml(r)}</option>`;
    });
    if (!rolOptions.includes(currentRol) && currentRol) {
      rolSelectHtml += `<option value="${escapeHtml(currentRol)}" selected>${escapeHtml(currentRol)}</option>`;
    }
    rolSelectHtml += `</select>`;

    let stSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:95px; font-weight:700;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Estado_Confirmacion', this.value)">`;
    stOptions.forEach(s => {
      stSelectHtml += `<option value="${s}" ${s === currentSt ? "selected" : ""}>${s}</option>`;
    });
    stSelectHtml += `</select>`;

    tr.innerHTML = `
      <td style="padding:8px 10px; text-align:center;">${guestThumbHtml}</td>
      <td style="padding:8px 10px;">
        <input type="text" class="inline-table-input" value="${escapeHtml(nombreFinal)}" style="font-weight:700; font-size:13px; color:#1D1D1F;"
               onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Nombre_Completo', this.value)" placeholder="Nombre del invitado" />
      </td>
      <td style="padding:8px 10px;">
        <div style="display:flex; align-items:center; gap:4px;">
          <input type="text" class="inline-table-input" value="${escapeHtml(tel)}" style="font-size:12px; min-width:95px;"
                 onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Telefono', this.value)" placeholder="0414..." />
          ${waBtn}
        </div>
      </td>
      <td style="padding:8px 10px;">${rolSelectHtml}</td>
      <td style="padding:8px 10px; text-align:center;">${stSelectHtml}</td>
      <td style="padding:8px 10px; text-align:center;">
        <input type="number" min="0" max="20" class="inline-table-input-sm" value="${acompNum}" style="width:48px; text-align:center; font-weight:700;"
               onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Acompanantes_Adicionales', this.value)" />
      </td>
      <td style="padding:8px 10px;">
        <input type="text" class="inline-table-input" value="${escapeHtml(rawDiet)}" style="font-size:12px;"
               onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Restricciones_Alimentarias', this.value)" placeholder="Ninguna" />
      </td>
      <td style="padding:8px 10px;">
        <select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; width:100%; min-width:85px;" onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Mesa_Asignada', this.value)">
          ${getTableOptionsHtml(inv.Mesa_Asignada || "")}
        </select>
      </td>
      <td style="padding:8px 10px;">
        <input type="text" class="inline-table-input" value="${escapeHtml(notasFinal)}" style="font-size:11.5px; color:#555;"
               onchange="updateGuestInline('${escapeHtml(inv.ID_Invitado)}', 'Notas', this.value)" placeholder="Notas..." />
      </td>
      <td style="padding:8px 10px; text-align:right;">
        <div style="display:flex; justify-content:flex-end; gap:4px;">
          <button class="btn btn-secondary mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="openFullDetailModal('guest', '${escapeHtml(inv.ID_Invitado)}')" title="Ver ficha completa">🔍</button>
          <button class="btn btn-secondary mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="editGuest('${escapeHtml(inv.ID_Invitado)}')" title="Editar modal">✏️</button>
          <button class="btn btn-danger mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="deleteGuestAction('${escapeHtml(inv.ID_Invitado)}', '${escapeHtml(nombreFinal)}')" title="Eliminar">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openNewGuestModal() {
  document.getElementById("modalGuestTitle").textContent = "Nuevo Invitado";
  document.getElementById("guestId").value = "";
  document.getElementById("guestNombre").value = "";
  document.getElementById("guestTelefono").value = "";
  document.getElementById("guestRol").value = "Familia Novio";
  document.getElementById("guestEstado").value = "Pendiente";
  document.getElementById("guestAcompanantes").value = "0";
  document.getElementById("guestRestricciones").value = "";
  document.getElementById("guestMesa").value = "";
  document.getElementById("guestNotas").value = "";
  if (document.getElementById("guestFotoRuta")) document.getElementById("guestFotoRuta").value = "";
  if (document.getElementById("guestFotoFile")) document.getElementById("guestFotoFile").value = "";
  if (document.getElementById("guestFotoPreview")) document.getElementById("guestFotoPreview").innerHTML = "";
  openModal("modalGuest");
}

function editGuest(id) {
  const inv = (appData.invitados || []).find(x => x.ID_Invitado === id);
  if (!inv) return;
  document.getElementById("modalGuestTitle").textContent = "Editar Invitado (" + id + ")";
  document.getElementById("guestId").value = inv.ID_Invitado || "";
  document.getElementById("guestNombre").value = inv.Nombre_Comp || inv.Nombre_Completo || "";
  document.getElementById("guestTelefono").value = inv.Telefono !== undefined && inv.Telefono !== null ? String(inv.Telefono).trim() : "";
  document.getElementById("guestRol").value = inv.Rol_Cortejo || "Familia Novio";
  document.getElementById("guestEstado").value = inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente";
  document.getElementById("guestAcompanantes").value = inv.Acompanantes !== undefined ? inv.Acompanantes : (inv.Acompanantes_Adicionales || 0);
  document.getElementById("guestRestricciones").value = inv.Restricciones_ || inv.Restricciones_Alimentarias || "";
  document.getElementById("guestMesa").value = inv.Mesa_Asignada || "";
  document.getElementById("guestNotas").value = inv.Notas || "";
  if (document.getElementById("guestFotoRuta")) document.getElementById("guestFotoRuta").value = inv.Ruta_Foto || "";
  if (document.getElementById("guestFotoFile")) document.getElementById("guestFotoFile").value = "";
  if (document.getElementById("guestFotoPreview")) {
    if (inv.Ruta_Foto) {
      const pUrl = getPhotoUrl(inv.Ruta_Foto);
      if (pUrl) {
        document.getElementById("guestFotoPreview").innerHTML = `
          <div class="photo-preview-wrap" style="position:relative; display:inline-block; margin-top:8px;">
            <img src="${escapeHtml(pUrl)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px;border:1px solid #E5E5EA;"
                 onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <div style="display:none; width:70px; height:70px; border-radius:10px; border:1px solid #E5E5EA; background:#F2F2F7; align-items:center; justify-content:center; color:#8E8E93; font-size:12px;">📷 No disponible</div>
            <button type="button" class="btn-photo-remove" onclick="clearPhotoUpload('guest')" title="Eliminar fotografía">✕</button>
          </div>
        `;
      } else {
        document.getElementById("guestFotoPreview").innerHTML = "";
      }
    } else {
      document.getElementById("guestFotoPreview").innerHTML = "";
    }
  }
  openModal("modalGuest");
}

function generateNextGuestId() {
  const existingIds = (appData.invitados || [])
    .map(i => {
      const id = String(i.ID_Invitado || "");
      if (id.startsWith("INV-")) {
        const num = parseInt(id.replace("INV-", ""), 10);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    });
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  return `INV-${String(maxId + 1).padStart(3, "0")}`;
}

async function saveGuestAction() {
  try {
    const targetId = document.getElementById("guestId").value || generateNextGuestId();
    const nombre = (document.getElementById("guestNombre").value || "").trim() || "Invitado Sin Nombre";
    const tel = (document.getElementById("guestTelefono").value || "").trim();
    const rol = document.getElementById("guestRol").value || "Familia Novio";
    const estado = document.getElementById("guestEstado").value || "Pendiente";
    const acomp = parseInt(document.getElementById("guestAcompanantes").value, 10) || 0;
    const rest = (document.getElementById("guestRestricciones").value || "").trim() || "Ninguna";
    const mesa = cleanMesaName(document.getElementById("guestMesa").value || "");
    const notas = (document.getElementById("guestNotas").value || "").trim();

    const guest = {
      ID_Invitado: targetId,
      Nombre_Completo: nombre,
      Nombre_Comp: nombre,
      Telefono: tel,
      Rol_Cortejo: rol,
      Estado_Confirmacion: estado,
      Estado_Confirm: estado,
      Acompanantes_Adicionales: acomp,
      Acompanantes: acomp,
      Restricciones_Alimentarias: rest,
      Restricciones_: rest,
      Mesa_Asignada: mesa,
      Notas: notas,
      Ruta_Foto: document.getElementById("guestFotoRuta")?.value || "",
      modulo: "Invitados"
    };

    // Optimistic UI update in memory
    if (!appData.invitados) appData.invitados = [];
    const idx = appData.invitados.findIndex(x => x.ID_Invitado === targetId);
    if (idx !== -1) {
      appData.invitados[idx] = guest;
    } else {
      appData.invitados.push(guest);
    }

    // Persistir inmediatamente en localStorage
    syncAppDataToLocalStorage();

    renderGuestsTab();
    updateSummaryPills();
    renderDashboard();
    showToast("¡Invitado guardado exitosamente!", "success");

    // Persistir en la nube directamente a Google Sheets
    postDirectToGAS("save_guest", "guest", guest);
  } catch (err) {
    console.error("[saveGuestAction] Error:", err);
    showToast("⚠️ Ocurrió un error al procesar el invitado: " + err.message, "error");
  } finally {
    closeModal("modalGuest");
  }
}

function deleteGuestAction(id, name) {
  document.getElementById("confirmDeleteTitle").textContent = `¿Eliminar a "${name || id}"?`;
  document.getElementById("confirmDeleteWarning").textContent = `Esta acción removerá a este invitado de la lista de asistencia en la nube y no se puede recuperar.`;
  pendingDeleteAction = async () => {
    // Optimistic removal from in-memory array
    appData.invitados = (appData.invitados || []).filter(x => x.ID_Invitado !== id);
    try {
      localStorage.setItem("cached_invitados", JSON.stringify(appData.invitados));
    } catch (e) {}

    closeModal("modalConfirmDelete");
    renderGuestsTab();
    updateSummaryPills();
    renderDashboard();
    showToast("Invitado eliminado.", "success");

    postDirectToGAS("delete_guest", "ID_Invitado", id);
  };
  openModal("modalConfirmDelete");
}

async function syncGuestsCountToConfig() {
  let count = 0;
  (appData.invitados || []).forEach(i => {
    const st = String(i.Estado_Confirm || i.Estado_Confirmacion || "Pendiente").trim();
    const acomp = parseInt(i.Acompanantes !== undefined ? i.Acompanantes : i.Acompanantes_Adicionales, 10) || 0;
    if (st === "Confirmado") {
      count += 1 + acomp;
    }
  });

  if (count === 0) {
    (appData.invitados || []).forEach(i => {
      const acomp = parseInt(i.Acompanantes !== undefined ? i.Acompanantes : i.Acompanantes_Adicionales, 10) || 0;
      count += 1 + acomp;
    });
  }

  if (count === 0) {
    showToast("No hay invitados registrados para sincronizar.", "warning");
    return;
  }

  appData.config.Invitados_Base = count;
  const inp = document.getElementById("inputGuests");
  if (inp) inp.value = count;
  updateSummaryPills();
  renderDashboard();
  debouncedSaveConfig();
  showToast(`Cantidad de invitados sincronizada a ${count} personas en el presupuesto base.`, "success");
}

// ==========================================
// PESTAÑA: LOGÍSTICA & TAREAS (ESTILO ASANA)
// ==========================================
let taskSortCriteria = null;

function sortTasks(criteria) {
  taskSortCriteria = criteria;
  const btnA = document.getElementById("btnSortTasksAlpha");
  const btnD = document.getElementById("btnSortTasksDate");
  if (btnA) btnA.classList.toggle("btn-sort-active", criteria === "alpha");
  if (btnD) btnD.classList.toggle("btn-sort-active", criteria === "date");
  renderTasksTab();
}

function renderTasksTab() {
  const list = appData.tareas || [];

  let completedCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;

  list.forEach(t => {
    const st = (t.Estado || "Pendiente").trim();
    if (st === "Completada") completedCount++;
    else if (st === "En Progreso") inProgressCount++;
    else pendingCount++;
  });

  const elTot = document.getElementById("kpiTasksTotal");
  if (elTot) elTot.textContent = list.length;
  const elComp = document.getElementById("kpiTasksCompleted");
  if (elComp) elComp.textContent = completedCount;
  const elProg = document.getElementById("kpiTasksInProgress");
  if (elProg) elProg.textContent = inProgressCount;
  const elPend = document.getElementById("kpiTasksPending");
  if (elPend) elPend.textContent = pendingCount;

  // Filter Table
  const query = (document.getElementById("searchTasks")?.value || "").toLowerCase().trim();
  const stFilter = (document.getElementById("filterTaskStatus")?.value || "").trim();
  const assFilter = (document.getElementById("filterTaskAssignee")?.value || "").trim();
  const catFilter = (document.getElementById("filterTaskCategory")?.value || "").trim();

  const tbody = document.getElementById("tbodyTasks");
  if (!tbody) return;
  tbody.innerHTML = "";

  const filtered = list.filter(t => {
    const matchQuery = !query ||
      (t.Titulo_Tarea || "").toLowerCase().includes(query) ||
      (t.Categoria_Logistica || "").toLowerCase().includes(query) ||
      (t.Responsable || "").toLowerCase().includes(query) ||
      (t.Notas || "").toLowerCase().includes(query);
    const matchStatus = !stFilter || (t.Estado || "Pendiente") === stFilter;
    const matchAssignee = !assFilter || (t.Responsable || "") === assFilter;
    const matchCat = !catFilter || (t.Categoria_Logistica || "") === catFilter;
    return matchQuery && matchStatus && matchAssignee && matchCat;
  });

  // Ordenamiento interactivo
  if (taskSortCriteria === "alpha") {
    filtered.sort((a, b) => String(a.Titulo_Tarea || "").localeCompare(String(b.Titulo_Tarea || ""), undefined, { sensitivity: "base" }));
  } else if (taskSortCriteria === "date") {
    filtered.sort((a, b) => {
      const da = a.Fecha_Limite ? new Date(a.Fecha_Limite).getTime() : 9999999999999;
      const db = b.Fecha_Limite ? new Date(b.Fecha_Limite).getTime() : 9999999999999;
      return da - db;
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align:center; padding:36px; color:var(--text-secondary);">
          ${list.length === 0 ? "No hay tareas registradas todavía. Haz clic en <strong>+ Nueva Tarea</strong> para comenzar el plan logístico." : "No se encontraron tareas con los filtros seleccionados."}
        </td>
      </tr>
    `;
    return;
  }

  const catOptions = getAllCategories();
  const respOptions = ["Vanessa", "Luis", "Ambos", "Coordinador", "Familiares", "Proveedor"];
  const prioOptions = ["Alta", "Media", "Baja"];
  const stTaskOptions = ["Pendiente", "En Progreso", "Completada"];

  filtered.forEach(t => {
    const isCompleted = (t.Estado || "Pendiente") === "Completada";
    const tr = document.createElement("tr");
    tr.className = "task-item-row" + (isCompleted ? " completed" : "");
    tr.style.borderBottom = "1px solid rgba(0,0,0,0.06)";
    tr.setAttribute("data-task-id", t.ID_Tarea);

    const cleanDate = t.Fecha_Limite ? String(t.Fecha_Limite).trim().split("T")[0] : "";
    const currentCat = t.Categoria_Logistica || "Logística";
    const currentResp = t.Responsable || "Ambos";
    const currentPrio = t.Prioridad || "Media";
    const currentTaskSt = t.Estado || "Pendiente";

    const taskPhotoUrl = getPhotoUrl(t.Ruta_Foto);
    const taskThumbHtml = taskPhotoUrl ? `
      <img src="${escapeHtml(taskPhotoUrl)}" alt="Foto Tarea" class="thumbnail-clickable" style="width:34px; height:34px; object-fit:cover; border-radius:8px; border:1px solid #E5E5EA; cursor:pointer;"
           onclick="openFullDetailModal('task', '${t.ID_Tarea}')" title="Ver comprobante o foto"
           onerror="this.style.display='none';" />
    ` : `<span style="font-size:18px; color:#CCC;">📋</span>`;

    let catSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:105px;" onchange="updateTaskInline('${t.ID_Tarea}', 'Categoria_Logistica', this.value)">`;
    catOptions.forEach(c => {
      catSelectHtml += `<option value="${escapeHtml(c)}" ${c.toLowerCase() === currentCat.toLowerCase() ? "selected" : ""}>${escapeHtml(c)}</option>`;
    });
    if (!catOptions.some(c => c.toLowerCase() === currentCat.toLowerCase()) && currentCat) {
      catSelectHtml += `<option value="${escapeHtml(currentCat)}" selected>${escapeHtml(currentCat)}</option>`;
    }
    catSelectHtml += `</select>`;

    let respSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:90px;" onchange="updateTaskInline('${t.ID_Tarea}', 'Responsable', this.value)">`;
    respOptions.forEach(r => {
      respSelectHtml += `<option value="${escapeHtml(r)}" ${r === currentResp ? "selected" : ""}>${escapeHtml(r)}</option>`;
    });
    if (!respOptions.includes(currentResp) && currentResp) {
      respSelectHtml += `<option value="${escapeHtml(currentResp)}" selected>${escapeHtml(currentResp)}</option>`;
    }
    respSelectHtml += `</select>`;

    let prioSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:75px; font-weight:700;" onchange="updateTaskInline('${t.ID_Tarea}', 'Prioridad', this.value)">`;
    prioOptions.forEach(p => {
      prioSelectHtml += `<option value="${p}" ${p === currentPrio ? "selected" : ""}>${p}</option>`;
    });
    prioSelectHtml += `</select>`;

    let stTaskSelectHtml = `<select class="inline-table-select" style="font-size:11.5px; padding:3px 6px; min-width:95px; font-weight:700;" onchange="updateTaskInline('${t.ID_Tarea}', 'Estado', this.value)">`;
    stTaskOptions.forEach(s => {
      stTaskSelectHtml += `<option value="${s}" ${s === currentTaskSt ? "selected" : ""}>${s}</option>`;
    });
    stTaskSelectHtml += `</select>`;

    tr.innerHTML = `
      <td style="padding:8px 10px; text-align:center;">
        <input type="checkbox" style="accent-color:var(--pink-primary); width:18px; height:18px; cursor:pointer;"
               ${isCompleted ? "checked" : ""} onchange="toggleTaskStatus('${t.ID_Tarea}', this.checked)" />
      </td>
      <td style="padding:8px 10px; text-align:center;">${taskThumbHtml}</td>
      <td style="padding:8px 10px;">
        <input type="text" class="inline-table-input" value="${escapeHtml(t.Titulo_Tarea || '')}" style="font-weight:700; font-size:13px; color:#1D1D1F;"
               onchange="updateTaskInline('${t.ID_Tarea}', 'Titulo_Tarea', this.value)" placeholder="Título de la tarea" />
      </td>
      <td style="padding:8px 10px;">${catSelectHtml}</td>
      <td style="padding:8px 10px;">${respSelectHtml}</td>
      <td style="padding:8px 10px;">
        <input type="date" class="inline-table-input" value="${cleanDate}" style="font-size:11.5px; padding:3px 5px;"
               onchange="updateTaskInline('${t.ID_Tarea}', 'Fecha_Limite', this.value)" />
      </td>
      <td style="padding:8px 10px; text-align:center;">${prioSelectHtml}</td>
      <td style="padding:8px 10px; text-align:center;">${stTaskSelectHtml}</td>
      <td style="padding:8px 10px;">
        <input type="text" class="inline-table-input" value="${escapeHtml(t.Notas || '')}" style="font-size:11.5px; color:#555;"
               onchange="updateTaskInline('${t.ID_Tarea}', 'Notas', this.value)" placeholder="Notas..." />
      </td>
      <td style="padding:8px 10px; text-align:right;">
        <div style="display:flex; justify-content:flex-end; gap:4px;">
          <button class="btn btn-secondary mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="openFullDetailModal('task', '${t.ID_Tarea}')" title="Ver ficha completa">🔍</button>
          <button class="btn btn-secondary mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="editTask('${t.ID_Tarea}')" title="Editar">✏️</button>
          <button class="btn btn-danger mini-btn-icon" style="padding:4px 6px; font-size:11px;" onclick="deleteTaskAction('${t.ID_Tarea}', '${escapeHtml(t.Titulo_Tarea || "")}')" title="Borrar">🗑️</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Edición en línea para tareas de logística con sincronización directa
async function updateTaskInline(taskId, field, value) {
  if (!appData.tareas) return;
  const task = appData.tareas.find(t => String(t.ID_Tarea || "").trim() === String(taskId || "").trim());
  if (!task) return;

  task[field] = value;
  syncAppDataToLocalStorage();

  // Si se actualizó el estado, refrescar vista y contadores
  if (field === "Estado") {
    renderTasksTab();
  }

  showToast("Dato de tarea guardado", "success", 1100);
  await postDirectToGAS("save_task", "task", task);
}
window.updateTaskInline = updateTaskInline;

function openNewTaskModal() {
  document.getElementById("modalTaskTitle").textContent = "Nueva Tarea Logística";
  document.getElementById("taskId").value = "";
  document.getElementById("taskTitulo").value = "";
  document.getElementById("taskCategoria").value = "General";
  document.getElementById("taskResponsable").value = "Ambos";
  document.getElementById("taskFechaLimite").value = "";
  document.getElementById("taskPrioridad").value = "Media";
  document.getElementById("taskEstado").value = "Pendiente";
  document.getElementById("taskNotas").value = "";
  if (document.getElementById("taskFotoRuta")) document.getElementById("taskFotoRuta").value = "";
  if (document.getElementById("taskFotoFile")) document.getElementById("taskFotoFile").value = "";
  if (document.getElementById("taskFotoPreview")) document.getElementById("taskFotoPreview").innerHTML = "";
  openModal("modalTask");
}

function editTask(id) {
  const t = (appData.tareas || []).find(x => x.ID_Tarea === id);
  if (!t) return;
  document.getElementById("modalTaskTitle").textContent = "Editar Tarea (" + id + ")";
  document.getElementById("taskId").value = t.ID_Tarea;
  document.getElementById("taskTitulo").value = t.Titulo_Tarea || "";
  document.getElementById("taskCategoria").value = t.Categoria_Logistica || "General";
  document.getElementById("taskResponsable").value = t.Responsable || "Ambos";
  document.getElementById("taskFechaLimite").value = t.Fecha_Limite || "";
  document.getElementById("taskPrioridad").value = t.Prioridad || "Media";
  document.getElementById("taskEstado").value = t.Estado || "Pendiente";
  document.getElementById("taskNotas").value = t.Notas || "";
  if (document.getElementById("taskFotoRuta")) document.getElementById("taskFotoRuta").value = t.Ruta_Foto || "";
  if (document.getElementById("taskFotoFile")) document.getElementById("taskFotoFile").value = "";
  if (document.getElementById("taskFotoPreview")) {
    if (t.Ruta_Foto) {
      const pUrl = getPhotoUrl(t.Ruta_Foto);
      if (pUrl) {
        document.getElementById("taskFotoPreview").innerHTML = `
          <div class="photo-preview-wrap" style="position:relative; display:inline-block; margin-top:8px;">
            <img src="${escapeHtml(pUrl)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px;border:1px solid #E5E5EA;"
                 onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <div style="display:none; width:70px; height:70px; border-radius:10px; border:1px solid #E5E5EA; background:#F2F2F7; align-items:center; justify-content:center; color:#8E8E93; font-size:12px;">📷 No disponible</div>
            <button type="button" class="btn-photo-remove" onclick="clearPhotoUpload('task')" title="Eliminar fotografía">✕</button>
          </div>
        `;
      } else {
        document.getElementById("taskFotoPreview").innerHTML = "";
      }
    } else {
      document.getElementById("taskFotoPreview").innerHTML = "";
    }
  }
  openModal("modalTask");
}

function generateNextTaskId() {
  const existingIds = (appData.tareas || [])
    .map(t => {
      const id = String(t.ID_Tarea || "");
      if (id.startsWith("TAR-")) {
        const num = parseInt(id.replace("TAR-", ""), 10);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    });
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  return `TAR-${String(maxId + 1).padStart(3, "0")}`;
}

async function saveTaskAction() {
  try {
    const targetId = document.getElementById("taskId").value || generateNextTaskId();
    const task = {
      ID_Tarea: targetId,
      Titulo_Tarea: (document.getElementById("taskTitulo").value || "").trim() || "Tarea Sin Título",
      Categoria_Logistica: document.getElementById("taskCategoria").value || "General",
      Responsable: document.getElementById("taskResponsable").value || "Ambos",
      Fecha_Limite: document.getElementById("taskFechaLimite").value || "",
      Prioridad: document.getElementById("taskPrioridad").value || "Media",
      Estado: document.getElementById("taskEstado").value || "Pendiente",
      Notas: (document.getElementById("taskNotas").value || "").trim(),
      Ruta_Foto: document.getElementById("taskFotoRuta")?.value || "",
      modulo: "Logistica"
    };

    // Optimistic UI update in memory
    if (!appData.tareas) appData.tareas = [];
    const idx = appData.tareas.findIndex(x => x.ID_Tarea === targetId);
    if (idx !== -1) {
      appData.tareas[idx] = task;
    } else {
      appData.tareas.push(task);
    }

    // Persistir inmediatamente en localStorage
    syncAppDataToLocalStorage();

    renderTasksTab();
    showToast("¡Tarea guardada exitosamente!", "success");

    // Persistir en la nube directamente a Google Sheets
    postDirectToGAS("save_task", "task", task);
  } catch (err) {
    console.error("[saveTaskAction] Error:", err);
    showToast("⚠️ Ocurrió un error al procesar la tarea: " + err.message, "error");
  } finally {
    closeModal("modalTask");
  }
}

async function toggleTaskStatus(id, isCompleted) {
  const task = (appData.tareas || []).find(x => x.ID_Tarea === id);
  if (!task) return;
  task.Estado = isCompleted ? "Completada" : "Pendiente";

  try {
    localStorage.setItem("cached_tareas", JSON.stringify(appData.tareas));
  } catch (e) {}
  renderTasksTab();
  showToast(isCompleted ? "¡Tarea marcada como completada! 🎉" : "Tarea reactivada como pendiente.", "success");

  postDirectToGAS("save_task", "task", task);
}

function deleteTaskAction(id, title) {
  document.getElementById("confirmDeleteTitle").textContent = `¿Eliminar tarea "${title || id}"?`;
  document.getElementById("confirmDeleteWarning").textContent = `Esta acción removerá esta tarea de la planificación logística en la nube y no se puede recuperar.`;
  pendingDeleteAction = async () => {
    // Optimistic removal from in-memory array
    appData.tareas = (appData.tareas || []).filter(x => x.ID_Tarea !== id);
    try {
      localStorage.setItem("cached_tareas", JSON.stringify(appData.tareas));
    } catch (e) {}

    closeModal("modalConfirmDelete");
    renderTasksTab();
    showToast("Tarea eliminada.", "success");

    postDirectToGAS("delete_task", "ID_Tarea", id);
  };
  openModal("modalConfirmDelete");
}

// PESTAÑA 4: DIRECTORIO DE PROVEEDORES & CATÁLOGO (ESTRUCTURA DE DOS NIVELES)
function renderProviders() {
  const grid = document.getElementById("providersGrid");
  const query = (document.getElementById("searchProviders").value || "").toLowerCase();
  const rubroFilter = document.getElementById("filterRubro").value;

  grid.innerHTML = "";

  const filtered = appData.proveedores.filter(p => {
    const matchQuery = !query || 
      (p.Nombre_Proveedor || "").toLowerCase().includes(query) ||
      (p.Rubro_General || "").toLowerCase().includes(query) ||
      (p.Ubicacion || "").toLowerCase().includes(query);
    const matchRubro = !rubroFilter || p.Rubro_General === rubroFilter;
    return matchQuery && matchRubro;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-secondary);">
      No se encontraron proveedores con ese criterio de búsqueda.
    </div>`;
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement("div");
    card.className = "provider-card";
    card.onclick = () => openProviderDetail(p.ID_Proveedor);

    const products = appData.catalogo.filter(c => c.ID_Proveedor === p.ID_Proveedor);
    const prodCount = products.length;

    let whatsappBtn = "";
    if (p.Link_WhatsApp) {
      whatsappBtn = `<a href="${p.Link_WhatsApp}" target="_blank" class="btn btn-whatsapp" onclick="event.stopPropagation()">
        <span>💬</span> WhatsApp
      </a>`;
    }

    let socialBtn = "";
    if (p.Link_Red_Social) {
      socialBtn = `<a href="${p.Link_Red_Social}" target="_blank" class="btn btn-secondary" onclick="event.stopPropagation()">
        <span>🔗</span> Red Social
      </a>`;
    }

    let bcvBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:12px; background:#F0F0F2; color:#555;">No Acepta BCV</span>`;
    if (p.Acepta_BCV === "Sí") {
      bcvBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:12px; background:#E8F8EE; color:#1B8738; font-weight:700;">Acepta BCV</span>`;
    } else if (p.Acepta_BCV === "Parcial") {
      bcvBadge = `<span style="font-size:11px; padding:3px 8px; border-radius:12px; background:#FFF8E6; color:#B26A00; font-weight:700;">BCV Parcial</span>`;
    }

    const provThumbHtml = renderProviderThumbnail(p.Ruta_Foto, p.Nombre_Proveedor, p.ID_Proveedor);

    card.innerHTML = `
      <div class="prov-header" style="display:flex; align-items:flex-start; gap:10px;">
        ${provThumbHtml}
        <div style="flex:1;">
          <div class="prov-title">${escapeHtml(p.Nombre_Proveedor || "Proveedor")}</div>
          <div style="margin-top:4px;">${bcvBadge}</div>
        </div>
        <span class="prov-rubro-badge">${escapeHtml(p.Rubro_General || "Otros")}</span>
      </div>

      <div class="prov-count-badge">
        <span>📦</span> ${prodCount} ${prodCount === 1 ? 'producto registrado' : 'productos registrados'}
      </div>

      <div class="prov-info-line">
        <span>📍</span> ${escapeHtml(p.Ubicacion || "Ubicación no especificada")}
      </div>
      <div class="prov-info-line">
        <span>📞</span> ${escapeHtml(p.Telefono_Contacto || "Sin teléfono")}
      </div>
      ${p.Notas_Proveedor ? `<div class="prov-info-line" style="font-style:italic;">📝 ${escapeHtml(p.Notas_Proveedor)}</div>` : ""}

      <div class="prov-actions">
        <button class="btn btn-blue" type="button" onclick="event.stopPropagation(); openProviderDetail('${p.ID_Proveedor}')">
          <span>👁️</span> Ver Productos
        </button>
        ${whatsappBtn}
        ${socialBtn}
        <button class="btn btn-secondary" type="button" onclick="event.stopPropagation(); editProvider('${p.ID_Proveedor}')">
          <span>✏️</span> Editar
        </button>
        <button class="btn btn-danger-soft" type="button" onclick="event.stopPropagation(); confirmDeleteProvider('${p.ID_Proveedor}')">
          <span>🗑️</span> Eliminar
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// VISTA INTERNA DEL PROVEEDOR
function openProviderDetail(provId) {
  currentViewingProviderId = provId;
  const p = appData.proveedores.find(x => x.ID_Proveedor === provId);
  if (!p) {
    backToProvidersList();
    return;
  }

  document.getElementById("viewProvidersList").style.display = "none";
  document.getElementById("viewProviderDetail").style.display = "block";

  renderProviderDetailHeader(p);
  renderProviderProductsTable(provId);
}

function backToProvidersList() {
  currentViewingProviderId = null;
  document.getElementById("viewProviderDetail").style.display = "none";
  document.getElementById("viewProvidersList").style.display = "block";
  renderProviders();
}

function renderProviderDetailHeader(p) {
  const headerCard = document.getElementById("providerDetailHeaderCard");
  const products = appData.catalogo.filter(c => c.ID_Proveedor === p.ID_Proveedor);

  let bcvBadge = `<span style="font-size:12px; padding:4px 10px; border-radius:12px; background:#F0F0F2; color:#555;">No Acepta BCV</span>`;
  if (p.Acepta_BCV === "Sí") {
    bcvBadge = `<span style="font-size:12px; padding:4px 10px; border-radius:12px; background:#E8F8EE; color:#1B8738; font-weight:700;">Acepta BCV (100%)</span>`;
  } else if (p.Acepta_BCV === "Parcial") {
    bcvBadge = `<span style="font-size:12px; padding:4px 10px; border-radius:12px; background:#FFF8E6; color:#B26A00; font-weight:700;">BCV Parcial</span>`;
  }

  let whatsappBtn = "";
  if (p.Link_WhatsApp) {
    whatsappBtn = `<a href="${p.Link_WhatsApp}" target="_blank" class="btn btn-whatsapp">
      <span>💬</span> Escribir por WhatsApp
    </a>`;
  }

  let socialBtn = "";
  if (p.Link_Red_Social) {
    socialBtn = `<a href="${p.Link_Red_Social}" target="_blank" class="btn btn-secondary">
      <span>🔗</span> Red Social / Enlace
    </a>`;
  }

  const provDetailThumbHtml = renderProviderThumbnail(p.Ruta_Foto, p.Nombre_Proveedor, p.ID_Proveedor);

  headerCard.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px;">
      <div style="display:flex; gap:14px; align-items:flex-start;">
        ${provDetailThumbHtml}
        <div>
          <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
            <h2 style="font-size:24px; font-weight:800; color:#1D1D1F; margin:0;">${escapeHtml(p.Nombre_Proveedor)}</h2>
            <span class="prov-rubro-badge" style="font-size:12px;">${escapeHtml(p.Rubro_General || "Otros")}</span>
            ${bcvBadge}
          </div>
          <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--text-secondary);">
            <div>📍 <strong>Ubicación:</strong> ${escapeHtml(p.Ubicacion || "No especificada")}</div>
            <div>📞 <strong>Teléfono:</strong> ${escapeHtml(p.Telefono_Contacto || "No registrado")}</div>
            ${p.Notas_Proveedor ? `<div>📝 <strong>Notas:</strong> ${escapeHtml(p.Notas_Proveedor)}</div>` : ""}
          </div>
        </div>
      </div>

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${whatsappBtn}
        ${socialBtn}
        <button class="btn btn-secondary" onclick="editProvider('${p.ID_Proveedor}')">
          <span>✏️</span> Editar Proveedor
        </button>
        <button class="btn btn-danger-soft" onclick="confirmDeleteProvider('${p.ID_Proveedor}')">
          <span>🗑️</span> Eliminar Proveedor
        </button>
      </div>
    </div>
  `;
}

function renderProviderThumbnail(photoSrc, altText = "Proveedor", provId = "") {
  const safeAlt = escapeHtml(altText || "Proveedor");
  const url = getPhotoUrl(photoSrc);

  if (!url) {
    return `
      <div style="display:flex; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:10px; color:#8E8E93; width:44px; height:44px; flex-shrink:0;" title="Sin logotipo o foto">
        <span style="font-size:20px;">🏢</span>
      </div>
    `;
  }

  return `
    <div style="position:relative; display:inline-block; cursor:pointer; flex-shrink:0;" ${provId ? `onclick="event.stopPropagation(); openFullDetailModal('provider', '${escapeHtml(provId)}')"` : ''} title="Ver foto del proveedor">
      <img src="${escapeHtml(url)}" alt="${safeAlt}" class="thumbnail-clickable" style="width:44px; height:44px; object-fit:cover; border-radius:10px; border:1px solid #E5E5EA; display:block;"
           onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
      <div style="display:none; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:10px; color:#8E8E93; width:44px; height:44px;" title="Imagen no disponible">
        <span style="font-size:20px;">🏢</span>
      </div>
    </div>
  `;
}

function renderProductThumbnail(photoSrc, altText = "Producto", size = "table", itemId = "") {
  const safeAlt = escapeHtml(altText || "Producto");
  const url = getPhotoUrl(photoSrc);

  if (size === "comparison") {
    if (!url) {
      return `
        <div class="comparison-thumb comparison-thumb-placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:12px; color:#8E8E93; height:180px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          <span style="font-size:11px; margin-top:6px; font-weight:600;">Sin foto</span>
        </div>
      `;
    }
    return `
      <div style="position:relative; width:100%; cursor:pointer;" ${itemId ? `onclick="openFullDetailModal('product', '${escapeHtml(itemId)}')"` : ''} title="Ver foto y ficha completa">
        <img src="${escapeHtml(url)}" alt="${safeAlt}" class="comparison-thumb thumbnail-clickable"
             onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
        <div class="comparison-thumb comparison-thumb-placeholder" style="display:none; flex-direction:column; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:12px; color:#8E8E93; height:180px;">
          <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
          <span style="font-size:11px; margin-top:6px; font-weight:600;">Foto no disponible</span>
        </div>
      </div>
    `;
  }

  // Default: table thumbnail (46px)
  if (!url) {
    return `
      <div class="prod-table-thumb" style="display:flex; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:8px; color:#8E8E93; width:46px; height:46px; margin:0 auto;" title="Sin foto">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
      </div>
    `;
  }

  return `
    <div style="position:relative; display:inline-block; cursor:pointer;" ${itemId ? `onclick="openFullDetailModal('product', '${escapeHtml(itemId)}')"` : ''} title="Ver foto y ficha completa">
      <img src="${escapeHtml(url)}" alt="${safeAlt}" class="prod-table-thumb thumbnail-clickable" style="width:46px; height:46px; object-fit:cover; border-radius:8px; display:block;"
           onerror="this.style.display='none'; if(this.parentElement && this.parentElement.nextElementSibling) this.parentElement.nextElementSibling.style.display='flex';" />
      <div class="prod-table-thumb" style="display:none; align-items:center; justify-content:center; background:#F2F2F7; border:1px solid #E5E5EA; border-radius:8px; color:#8E8E93; width:46px; height:46px;" title="Imagen no disponible">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
      </div>
    </div>
  `;
}

function renderProviderProductsTable(provId) {
  const tbody = document.getElementById("tbodyProviderProducts");
  if (!tbody) return;
  tbody.innerHTML = "";

  const products = (appData?.catalogo || []).filter(c => c && c.ID_Proveedor === provId);

  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; padding:40px; color:var(--text-secondary); font-size:14px;">
          Este proveedor aún no tiene productos registrados.<br>
          <button class="btn btn-primary" style="margin-top:14px;" onclick="openNewItemForCurrentProvider()">
            <span>➕</span> Agregar Primer Producto
          </button>
        </td>
      </tr>
    `;
    return;
  }

  products.forEach(item => {
    const qty = parseFloat(item?.Cantidad_Unidades) || 1;
    const price = parseFloat(item?.Precio_Unitario_Cotizado) || 0;
    const costs = calcItemCosts(
      item?.Tipo_Cobro || "Fijo Global",
      qty,
      price,
      item?.Moneda_Cotizada || "USD",
      item?.Forma_Pago_Exigida || "USD Efectivo (Billetes)"
    );

    const thumbHtml = renderProductThumbnail(item?.Ruta_Foto, item?.Producto_Comparable, "table", item?.ID_Item || "");

    const linkHtml = (item?.Link_Referencia && String(item.Link_Referencia).trim()) 
      ? `<a href="${escapeHtml(String(item.Link_Referencia).trim())}" target="_blank" class="btn btn-secondary" style="padding:2px 8px; font-size:10px; margin-top:4px;" title="Ver publicación">🔗 Link</a>`
      : "";

    let cobroLabel = item?.Tipo_Cobro || "Fijo Global";
    if (item?.Tipo_Cobro === "Por Unidad") {
      cobroLabel = `Por Unidad (${qty} uds)`;
    } else if (item?.Tipo_Cobro === "Por Invitado") {
      cobroLabel = `Por Invitado (x${appData?.config?.Invitados_Base || 100})`;
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="padding:12px 14px; text-align:center;">
        ${thumbHtml}
        ${linkHtml}
      </td>
      <td style="padding:12px 14px;">
        <div style="font-weight:700; font-size:14px; color:#1D1D1F; cursor:pointer;" onclick="openFullDetailModal('product', '${escapeHtml(item?.ID_Item || '')}')" title="Ver ficha técnica">${escapeHtml(item?.Producto_Comparable || "Producto")}</div>
        <span style="font-size:11px; background:#F2F2F7; padding:2px 6px; border-radius:6px; color:#555;">${escapeHtml(item?.Categoria || "Otros")}</span>
      </td>
      <td style="padding:12px 14px; color:#444; max-width:240px; line-height:1.4;">
        ${escapeHtml(item?.Detalle_Especificacion || "Sin especificaciones")}
      </td>
      <td style="padding:12px 14px; font-weight:600; color:#333;">
        ${escapeHtml(cobroLabel)}
      </td>
      <td style="padding:12px 14px;">
        <div style="font-weight:700; color:#1D1D1F;">${escapeHtml(item?.Moneda_Cotizada || "USD")} ${price}</div>
        <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${escapeHtml(item?.Forma_Pago_Exigida || "")}</div>
      </td>
      <td style="padding:12px 14px; text-align:right;">
        <div style="font-size:15px; font-weight:800; color:#1D1D1F;">${formatUSD(costs.cReal)}</div>
        <div style="font-size:11px; color:var(--text-secondary);">${formatVES(costs.cVes)}</div>
      </td>
      <td style="padding:12px 14px; text-align:center;">
        <div style="display:flex; justify-content:center; gap:6px;">
          <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="openFullDetailModal('product', '${escapeHtml(item?.ID_Item || '')}')" title="Ver ficha técnica">
            <span>🔍</span>
          </button>
          <button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="editItem('${escapeHtml(item?.ID_Item || "")}')">
            <span>✏️</span> Editar
          </button>
          <button class="btn btn-danger-soft" style="padding:4px 8px; font-size:11px;" onclick="confirmDeleteItem('${escapeHtml(item?.ID_Item || "")}')">
            <span>🗑️</span>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function openNewItemForCurrentProvider() {
  if (currentViewingProviderId) {
    openNewItemForProvider(currentViewingProviderId);
  } else {
    openNewItemModal();
  }
}

// MODALES DE CONFIRMACIÓN DE SEGURIDAD OBLIGATORIA AL ELIMINAR
function confirmDeleteProvider(provId) {
  const p = appData.proveedores.find(x => x.ID_Proveedor === provId);
  const name = p ? p.Nombre_Proveedor : provId;

  document.getElementById("confirmDeleteTitle").textContent = `¿Estás seguro de que deseas eliminar a "${name}"?`;
  document.getElementById("confirmDeleteWarning").innerHTML = `
    ⚠️ Esta acción eliminará permanentemente al proveedor y <strong>TODOS los productos asociados a él</strong> de la base de datos en la nube.<br><br>
    Esta acción no se puede deshacer.
  `;

  pendingDeleteAction = () => executeDeleteProvider(provId);
  openModal("modalConfirmDelete");
}

async function executeDeleteProvider(provId) {
  closeModal("modalConfirmDelete");
  appData.proveedores = (appData.proveedores || []).filter(x => x.ID_Proveedor !== provId);
  appData.catalogo = (appData.catalogo || []).filter(x => x.ID_Proveedor !== provId);
  syncAppDataToLocalStorage();

  if (currentViewingProviderId === provId) {
    backToProvidersList();
  } else {
    renderProviders();
  }
  showToast("Proveedor y sus productos eliminados exitosamente.", "success");
  postDirectToGAS("delete_provider", "ID_Proveedor", provId);
}

function confirmDeleteItem(itemId) {
  const item = appData.catalogo.find(x => x.ID_Item === itemId);
  const name = item ? (item.Producto_Comparable || item.Detalle_Especificacion || itemId) : itemId;

  document.getElementById("confirmDeleteTitle").textContent = `¿Estás seguro de que deseas eliminar "${name}"?`;
  document.getElementById("confirmDeleteWarning").innerHTML = `
    ⚠️ Esta acción eliminará el producto del catálogo y de cualquier presupuesto donde esté incluido en la base de datos en la nube.<br><br>
    Esta acción no se puede deshacer.
  `;

  pendingDeleteAction = () => executeDeleteItem(itemId);
  openModal("modalConfirmDelete");
}

async function executeDeleteItem(itemId) {
  closeModal("modalConfirmDelete");
  appData.catalogo = (appData.catalogo || []).filter(x => x.ID_Item !== itemId);
  syncAppDataToLocalStorage();

  if (currentViewingProviderId) {
    const p = appData.proveedores.find(x => x.ID_Proveedor === currentViewingProviderId);
    if (p) renderProviderDetailHeader(p);
    renderProviderProductsTable(currentViewingProviderId);
  }
  renderComparableDropdown();
  showToast("Producto eliminado exitosamente.", "success");
  postDirectToGAS("delete_item", "ID_Item", itemId);
}

// ==========================================
// PESTAÑA 3: COMPARADOR DE PRODUCTOS (HASTA 3 EN PARALELO)
// ==========================================

function populateTripleComparisonSelectors(filterKeyword = "") {
  const selGroup = document.getElementById("selectComparablePreset");
  const slot1 = document.getElementById("compSlot1");
  const slot2 = document.getElementById("compSlot2");
  const slot3 = document.getElementById("compSlot3");

  if (!slot1 || !slot2) return;

  const prevVal1 = slot1.value;
  const prevVal2 = slot2.value;
  const prevVal3 = slot3 ? slot3.value : "";
  const prevGroup = selGroup ? selGroup.value : "";

  // 1. Grupos de productos comparables
  if (selGroup) {
    const groupsMap = new Map();
    (appData?.catalogo || []).forEach(c => {
      const g = (c?.Producto_Comparable || "").trim();
      if (g) {
        const lower = g.toLowerCase();
        if (!groupsMap.has(lower)) groupsMap.set(lower, g);
      }
    });
    const uniqueGroups = Array.from(groupsMap.values());
    let groupHtml = `<option value="">-- Selecciona un grupo para cargar opciones automáticamente --</option>`;
    uniqueGroups.forEach(g => {
      groupHtml += `<option value="${escapeHtml(g)}">🏷️ ${escapeHtml(g)}</option>`;
    });
    selGroup.innerHTML = groupHtml;
    if (prevGroup) selGroup.value = prevGroup;
  }

  // 2. Opciones de productos para los 3 slots con filtrado rápido por palabra clave
  const kw = (filterKeyword || document.getElementById("inputCompFilterKeyword")?.value || "").trim().toLowerCase();
  const catalog = (appData?.catalogo || []).filter(item => {
    if (!kw) return true;
    const title = (item.Producto_Comparable || "").toLowerCase();
    const cat = (item.Categoria || "").toLowerCase();
    const prov = (item.Nombre_Proveedor || "").toLowerCase();
    const spec = (item.Detalle_Especificacion || "").toLowerCase();
    return title.includes(kw) || cat.includes(kw) || prov.includes(kw) || spec.includes(kw);
  });

  let optionsHtml = `<option value="">-- Seleccionar producto (${catalog.length} disponibles) --</option>`;
  catalog.forEach(item => {
    const prov = (appData?.proveedores || []).find(p => p.ID_Proveedor === item.ID_Proveedor);
    const provName = prov?.Nombre_Proveedor || item.Nombre_Proveedor || "Proveedor";
    const title = item.Producto_Comparable || item.Categoria || "Producto";
    const priceText = `${formatUSD(parseFloat(item.Precio_Unitario_Cotizado) || 0)}`;
    optionsHtml += `<option value="${escapeHtml(item.ID_Item)}">${escapeHtml(title)} — ${escapeHtml(provName)} (${priceText})</option>`;
  });

  slot1.innerHTML = optionsHtml;
  slot2.innerHTML = optionsHtml;
  if (slot3) {
    slot3.innerHTML = `<option value="">-- Ninguno (Solo 2 productos) --</option>` + optionsHtml.replace(`<option value="">-- Seleccionar producto (${catalog.length} disponibles) --</option>`, '');
  }

  // Restaurar selecciones o aplicar selecciones predeterminadas inteligentes
  if (prevVal1 && catalog.some(c => c.ID_Item === prevVal1)) {
    slot1.value = prevVal1;
  } else if (catalog.length > 0) {
    slot1.value = catalog[0].ID_Item;
  }

  if (prevVal2 && catalog.some(c => c.ID_Item === prevVal2)) {
    slot2.value = prevVal2;
  } else if (catalog.length > 1) {
    slot2.value = catalog[1].ID_Item;
  }

  if (slot3) {
    if (prevVal3 && catalog.some(c => c.ID_Item === prevVal3)) {
      slot3.value = prevVal3;
    } else if (catalog.length > 2 && !prevVal1 && !prevVal2) {
      slot3.value = catalog[2].ID_Item;
    }
  }

  renderTripleComparison();
}

function applyComparablePreset(groupName) {
  if (!groupName) return;
  const groupLower = groupName.trim().toLowerCase();
  const matchingItems = (appData?.catalogo || []).filter(c => (c?.Producto_Comparable || "").trim().toLowerCase() === groupLower);

  if (matchingItems.length === 0) {
    showToast(`No hay productos bajo el grupo "${groupName}".`, "info");
    return;
  }

  const slot1 = document.getElementById("compSlot1");
  const slot2 = document.getElementById("compSlot2");
  const slot3 = document.getElementById("compSlot3");

  if (slot1 && matchingItems[0]) slot1.value = matchingItems[0].ID_Item;
  if (slot2 && matchingItems[1]) slot2.value = matchingItems[1].ID_Item;
  else if (slot2) slot2.value = "";
  if (slot3 && matchingItems[2]) slot3.value = matchingItems[2].ID_Item;
  else if (slot3) slot3.value = "";

  renderTripleComparison();
  showToast(`Cargados ${Math.min(matchingItems.length, 3)} productos del grupo "${groupName}".`, "success");
}
window.applyComparablePreset = applyComparablePreset;

window.filterComparatorProducts = function(kw) {
  populateTripleComparisonSelectors(kw);
};

window.recalculateComparatorMultipliers = function() {
  renderTripleComparison();
};

function renderTripleComparison() {
  const grid = document.getElementById("tripleComparisonGrid");
  const diffBox = document.getElementById("tripleComparisonDiffBox");
  if (!grid) return;

  const id1 = document.getElementById("compSlot1")?.value || "";
  const id2 = document.getElementById("compSlot2")?.value || "";
  const id3 = document.getElementById("compSlot3")?.value || "";

  const selectedSlots = [
    { id: id1, slotNum: 1 },
    { id: id2, slotNum: 2 },
    { id: id3, slotNum: 3 }
  ].filter(s => s.id);

  if (selectedSlots.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:44px 20px; color:var(--text-secondary); background:#FAF9FB; border-radius:16px; border:1px dashed #D1D1D6;">
        <div style="font-size:36px; margin-bottom:8px;">⚖️</div>
        <div style="font-size:16px; font-weight:700; color:#1D1D1F; margin-bottom:4px;">Selecciona productos para comparar</div>
        <div style="font-size:13px;">Elige al menos 2 productos en los selectores superiores para ver su comparativa cara a cara.</div>
      </div>
    `;
    if (diffBox) diffBox.style.display = "none";
    return;
  }

  // Resolver y evaluar items considerando el multiplicador de cada columna
  const evaluatedItems = [];
  selectedSlots.forEach(({ id, slotNum }) => {
    const item = (appData?.catalogo || []).find(c => String(c.ID_Item || '').trim() === String(id).trim());
    if (!item) return;

    const qtyInp = document.getElementById(`compQty${slotNum}`);
    const userQty = qtyInp ? (parseFloat(qtyInp.value) || 1) : (parseFloat(item.Cantidad_Unidades) || 1);
    const qty = userQty > 0 ? userQty : 1;
    const price = parseFloat(item.Precio_Unitario_Cotizado) || 0;

    const costs = calcItemCosts(
      item.Tipo_Cobro || "Fijo Global",
      qty,
      price,
      item.Moneda_Cotizada || "USD",
      item.Forma_Pago_Exigida || "USD Efectivo (Billetes)",
      parseFloat(appData?.config?.Invitados_Base) || 100
    );

    const prov = (appData?.proveedores || []).find(p => p.ID_Proveedor === item.ID_Proveedor);
    const provName = prov?.Nombre_Proveedor || item.Nombre_Proveedor || "Proveedor";

    evaluatedItems.push({
      item,
      costs,
      provName,
      prov,
      slotNum,
      qty
    });
  });

  if (evaluatedItems.length === 0) {
    grid.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-secondary);">
        No se pudieron cargar los datos de los productos seleccionados.
      </div>
    `;
    if (diffBox) diffBox.style.display = "none";
    return;
  }

  // Identificar el de menor Costo Binance (si hay 2 o más)
  const minCost = Math.min(...evaluatedItems.map(x => x.costs.cReal));
  const hasMultiple = evaluatedItems.length >= 2;

  let gridHtml = "";
  evaluatedItems.forEach(({ item, costs, provName, slotNum, qty }) => {
    const isWinner = hasMultiple && costs.cReal === minCost;
    const imgHtml = renderProductThumbnail(item?.Ruta_Foto, item?.Producto_Comparable, "comparison", item?.ID_Item || "");

    gridHtml += `
      <div class="triple-comp-card ${isWinner ? 'is-winner' : ''}">
        ${isWinner ? `<div class="winner-pill">⭐ Mejor Costo Binance</div>` : ""}

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-size:12px; font-weight:800; background:#F2F2F7; color:#1D1D1F; padding:3px 10px; border-radius:8px;">
            Opción #${slotNum} (${qty} ${qty === 1 ? 'ud' : 'uds'})
          </span>
          <span class="cat-badge" style="font-size:11px;">${escapeHtml(item.Categoria || "General")}</span>
        </div>

        <div style="margin-bottom:12px;">
          ${imgHtml}
        </div>

        <div style="margin-bottom:4px; font-size:18px; font-weight:800; color:#1D1D1F; cursor:pointer;" onclick="openFullDetailModal('provider', '${escapeHtml(item.ID_Proveedor || '')}')">
          🏢 ${escapeHtml(provName)}
        </div>

        <div style="font-size:14px; font-weight:700; color:#D81B60; margin-bottom:10px; cursor:pointer;" onclick="openFullDetailModal('product', '${escapeHtml(item.ID_Item)}')">
          🏷️ ${escapeHtml(item.Producto_Comparable || item.Categoria || "Producto")}
        </div>

        <div style="background:#FAF9FB; border-radius:12px; padding:12px; margin-bottom:12px; border:1px solid rgba(0,0,0,0.06);">
          <div style="font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-weight:700; margin-bottom:2px;">
            Costo Binance (USDT)
          </div>
          <div style="font-size:24px; font-weight:900; color:#1D1D1F; letter-spacing:-0.5px;">
            ${formatUSD(costs.cReal)}
          </div>
          <div style="font-size:12px; color:var(--text-secondary); font-weight:600; margin-top:2px;">
            Equivalente: ${formatVES(costs.cVes)}
          </div>
        </div>

        <div style="background:#FFFFFF; border:1px solid rgba(0,0,0,0.08); border-radius:10px; padding:10px; font-size:12px; line-height:1.7; color:#444; margin-bottom:12px;">
          <div><strong>Cotización Nominal:</strong> ${formatNumber(costs.cNom)} ${escapeHtml(item.Moneda_Cotizada || 'USD')}</div>
          <div><strong>Modalidad de Cobro:</strong> ${escapeHtml(item.Tipo_Cobro || 'Fijo Global')}</div>
          <div><strong>Forma de Pago Exigida:</strong> ${escapeHtml(item.Forma_Pago_Exigida || 'No especificada')}</div>
        </div>

        <div style="font-size:12.5px; color:#555; background:#FAF9FB; padding:10px; border-radius:8px; border:1px solid rgba(0,0,0,0.04); min-height:46px; line-height:1.45; margin-bottom:14px; flex:1;">
          <strong>Especificaciones:</strong> ${escapeHtml(item.Detalle_Especificacion || "Sin especificaciones adicionales")}
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <button type="button" class="btn btn-secondary" style="width:100%; justify-content:center; font-weight:700; font-size:13px; padding:9px 12px;" onclick="openFullDetailModal('product', '${escapeHtml(item.ID_Item)}')">
            🔍 Ver Ficha Completa
          </button>
          ${item.Link_Referencia ? `
            <a href="${escapeHtml(item.Link_Referencia)}" target="_blank" class="btn btn-secondary" style="width:100%; justify-content:center; font-weight:600; font-size:12px; padding:7px 12px;">
              🌐 Ver Referencia Web
            </a>
          ` : ""}
        </div>
      </div>
    `;
  });

  grid.innerHTML = gridHtml;

  // Renderizar Resumen y Análisis de Diferencias
  if (diffBox) {
    if (hasMultiple) {
      const sorted = [...evaluatedItems].sort((a, b) => a.costs.cReal - b.costs.cReal);
      const best = sorted[0];
      const second = sorted[1];
      const diff1 = second.costs.cReal - best.costs.cReal;
      const diffNom1 = Math.abs(second.costs.cNom - best.costs.cNom);
      const diffVes1 = Math.abs(second.costs.cVes - best.costs.cVes);
      const diffPct1 = second.costs.cReal > 0 ? ((diff1 / second.costs.cReal) * 100).toFixed(1) : 0;

      let analysisHtml = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="font-size:20px;">💡</span>
          <span style="font-size:15px; font-weight:800; color:#1D1D1F;">Análisis Comparativo & Recomendación</span>
        </div>
        <div style="font-size:13px; color:#333; line-height:1.6;">
          La opción más económica es <strong>"${escapeHtml(best.item.Producto_Comparable || best.item.Categoria)}"</strong> de <strong>"${escapeHtml(best.provName)}"</strong> con un Costo Binance de <strong>${formatUSD(best.costs.cReal)}</strong>.
          <br />
          Representa un ahorro directo de <strong>${formatUSD(diff1)} (${diffPct1}%)</strong> en comparación con la opción de "${escapeHtml(second.provName)}" (${formatUSD(second.costs.cReal)}). Diferencia en bolívares: <strong>${formatVES(diffVes1)}</strong>.
      `;

      if (sorted.length === 3) {
        const third = sorted[2];
        const diff2 = third.costs.cReal - best.costs.cReal;
        const diffVes2 = Math.abs(third.costs.cVes - best.costs.cVes);
        const diffPct2 = third.costs.cReal > 0 ? ((diff2 / third.costs.cReal) * 100).toFixed(1) : 0;
        analysisHtml += `
          <br />
          Frente a la opción más costosa ("${escapeHtml(third.provName)}" en ${formatUSD(third.costs.cReal)}), el ahorro total asciende a <strong>${formatUSD(diff2)} (${diffPct2}%)</strong> (equivalente a ${formatVES(diffVes2)}).
        `;
      }

      analysisHtml += `</div>`;
      diffBox.innerHTML = analysisHtml;
      diffBox.style.display = "block";
    } else {
      diffBox.style.display = "none";
    }
  }
}

// Funciones puente para mantener compatibilidad con llamadas existentes
function renderComparableDropdown() {
  populateTripleComparisonSelectors();
}

function renderComparisonItems() {
  renderTripleComparison();
}

// ==========================================
// PESTAÑA 4: PRESUPUESTOS (VISTA LIMPIA HISTÓRICA, POP-UP MODAL & COMPARADOR DINÁMICO)
// ==========================================

let previewScenarioId = null;
let modalBudgetRows = [];
let modalBudgetScId = "";

function renderScenariosTab() {
  populateScenarioDropdowns();
  renderScenarioHistoryTable();
  renderSideBySideComparison();
}

// 1. HISTORIAL DE PRESUPUESTOS (TABLA SUPERIOR)
function renderScenarioHistoryTable() {
  const tbody = document.getElementById("tbodyScenarioHistory");
  if (!tbody) return;
  tbody.innerHTML = "";

  const uniqueScenarios = getUniqueScenarios();
  const guests = parseFloat(appData.config.Invitados_Base) || 100;

  if (uniqueScenarios.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; padding:36px 20px; color:var(--text-secondary);">
          <div style="font-size:26px; margin-bottom:8px;">📁</div>
          <div style="font-weight:700; color:#1D1D1F; font-size:14px; margin-bottom:4px;">No hay presupuestos registrados aún</div>
          <div style="font-size:13px; margin-bottom:14px;">Haz clic en el botón rojo <strong>"+ Crear Nuevo Presupuesto"</strong> para abrir la ventana modal y armar tu primera opción.</div>
          <button class="btn btn-primary mini-btn" onclick="openNewBudgetModal()" style="background:#D81B60; border-color:#D81B60; font-weight:700;">
            <span>➕</span> Crear Primer Presupuesto
          </button>
        </td>
      </tr>
    `;
    return;
  }

  uniqueScenarios.forEach(sc => {
    const allRows = appData.escenarios_rows.filter(r => r.ID_Escenario === sc.id);
    const validRows = allRows.filter(r => r.ID_Item && String(r.ID_Item).trim() !== "");
    const scGuests = parseFloat(allRows[0]?.Invitados_Escenario) || guests;
    let totReal = 0, totVes = 0;

    validRows.forEach(r => {
      const item = appData.catalogo.find(c => c.ID_Item === r.ID_Item) || r;
      const qty = parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1;
      const c = calcItemCosts(item.Tipo_Cobro, qty, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, scGuests);
      totReal += c.cReal;
      totVes += c.cVes;
    });

    const isCurrentActive = sc.id === activeScenarioId;

    const tr = document.createElement("tr");
    tr.style.borderBottom = "1px solid rgba(0,0,0,0.06)";
    if (isCurrentActive) {
      tr.style.background = "rgba(248, 187, 208, 0.12)";
    }

    tr.innerHTML = `
      <td style="padding:12px 14px;">
        <div style="font-weight:700; color:#1D1D1F; font-size:14px; display:flex; align-items:center; gap:8px;">
          ${escapeHtml(sc.name)}
          <span style="font-size:11px; padding:2px 8px; border-radius:8px; background:#F2F2F7; color:#666; font-weight:600;">${escapeHtml(sc.id)}</span>
          ${isCurrentActive ? '<span style="font-size:11px; padding:2px 8px; border-radius:8px; background:#E8F8EE; color:#1B8738; font-weight:700;">Activo</span>' : ''}
        </div>
        <div style="font-size:11.5px; color:var(--text-secondary); margin-top:2px;">
          👥 ${scGuests} invitados • Costo x Invitado: <strong>${formatUSD(scGuests > 0 ? totReal / scGuests : 0)}</strong>
        </div>
      </td>
      <td style="padding:12px 14px; text-align:center;">
        <span style="font-size:12px; font-weight:700; background:#F0F0F2; padding:3px 10px; border-radius:12px;">
          📦 ${validRows.length} ${validRows.length === 1 ? "ítem" : "ítems"}
        </span>
      </td>
      <td style="padding:12px 14px; text-align:right; font-weight:800; font-size:14px; color:#1D1D1F;">
        ${formatUSD(totReal)}
      </td>
      <td style="padding:12px 14px; text-align:right; font-weight:600; color:var(--text-secondary);">
        ${formatVES(totVes)}
      </td>
      <td style="padding:12px 14px; text-align:center;">
        <div style="display:inline-flex; gap:6px; flex-wrap:wrap; justify-content:center;">
          <button class="btn btn-secondary mini-btn" onclick="toggleScenarioPreview('${sc.id}')" title="Ver previsualización de ítems">
            👁️ Ver Ítems
          </button>
          <button class="btn btn-primary mini-btn" onclick="openEditBudgetModal('${sc.id}')" title="Editar en ventana emergente">
            ✏️ Editar
          </button>
          <button class="btn btn-secondary mini-btn-icon" onclick="exportScenarioPdfById('${sc.id}')" title="Exportar a PDF">
            📄
          </button>
          <button class="btn btn-secondary mini-btn-icon" onclick="deleteScenarioById('${sc.id}')" title="Eliminar este presupuesto">
            🗑️
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleScenarioPreview(scId) {
  const container = document.getElementById("scenarioPreviewContainer");
  const title = document.getElementById("previewScenarioTitle");
  const content = document.getElementById("previewScenarioContent");
  if (!container || !content) return;

  if (previewScenarioId === scId && container.style.display !== "none") {
    container.style.display = "none";
    previewScenarioId = null;
    return;
  }

  previewScenarioId = scId;
  const allRows = appData.escenarios_rows.filter(r => r.ID_Escenario === scId);
  const rows = allRows.filter(r => r.ID_Item && String(r.ID_Item).trim() !== "");
  const scName = (allRows[0] && allRows[0].Nombre_Escenario) || scId;
  const guests = parseFloat(allRows[0]?.Invitados_Escenario) || (parseFloat(appData.config.Invitados_Base) || 100);

  title.innerHTML = `📦 Previsualización de Ítems: <strong>${escapeHtml(scName)}</strong> (${rows.length} productos • ${guests} invitados)`;

  if (rows.length === 0) {
    content.innerHTML = `<div style="padding:16px; text-align:center; color:var(--text-secondary); font-size:13px;">Este presupuesto no tiene productos agregados todavía. Pulsa <strong>"✏️ Editar"</strong> para cargarlos en el pop-up.</div>`;
  } else {
    let html = `
      <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:8px;">
        <thead>
          <tr style="border-bottom:1px solid rgba(0,0,0,0.08); background:#FFF; text-align:left;">
            <th style="padding:8px 10px;">Rubro</th>
            <th style="padding:8px 10px;">Proveedor</th>
            <th style="padding:8px 10px;">Producto / Servicio</th>
            <th style="padding:8px 10px; text-align:center;">Cant.</th>
            <th style="padding:8px 10px; text-align:right;">Subtotal Binance ($)</th>
            <th style="padding:8px 10px; text-align:right;">Subtotal VES</th>
          </tr>
        </thead>
        <tbody>
    `;

    rows.forEach(r => {
      const item = appData.catalogo.find(c => c.ID_Item === r.ID_Item) || r;
      const qty = parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1;
      const c = calcItemCosts(item.Tipo_Cobro, qty, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, guests);
      html += `
        <tr style="border-bottom:1px solid rgba(0,0,0,0.04);">
          <td style="padding:7px 10px;"><span class="cat-badge">${escapeHtml(item.Categoria || "General")}</span></td>
          <td style="padding:7px 10px; font-weight:600;">${escapeHtml(item.Nombre_Proveedor || "")}</td>
          <td style="padding:7px 10px;">
            <span style="font-weight:600;">${escapeHtml(item.Producto_Comparable || "Producto")}</span>
            ${item.Detalle_Especificacion ? `<span style="color:var(--text-secondary); font-size:11px;"> - ${escapeHtml(item.Detalle_Especificacion)}</span>` : ""}
          </td>
          <td style="padding:7px 10px; text-align:center; font-weight:700;">${qty}</td>
          <td style="padding:7px 10px; text-align:right; font-weight:700;">${formatUSD(c.cReal)}</td>
          <td style="padding:7px 10px; text-align:right; color:var(--text-secondary);">${formatVES(c.cVes)}</td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    content.innerHTML = html;
  }

  container.style.display = "block";
}

function closeScenarioPreview() {
  const container = document.getElementById("scenarioPreviewContainer");
  if (container) container.style.display = "none";
  previewScenarioId = null;
}

// 2. VENTANA MODAL (POP-UP) ELEGANTE DE FACTURA DE PRESUPUESTO
function generateNextScenarioId() {
  const existingIds = (appData.escenarios_rows || [])
    .map(r => {
      const id = String(r.ID_Escenario || "");
      if (id.startsWith("ESC-")) {
        const num = parseInt(id.replace("ESC-", ""), 10);
        return isNaN(num) ? 0 : num;
      }
      return 0;
    });
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
  const nextNum = maxId + 1;
  return `ESC-${String(nextNum).padStart(2, "0")}`;
}

function openNewBudgetModal() {
  modalBudgetScId = "";
  const elId = document.getElementById("modalBudgetId");
  const elName = document.getElementById("modalBudgetName");
  const elGuests = document.getElementById("modalBudgetGuests");
  const elTitle = document.getElementById("modalBudgetTitle");

  if (elId) elId.value = "";
  if (elName) elName.value = "";
  if (elGuests) elGuests.value = appData?.config?.Invitados_Base || 100;
  if (elTitle) elTitle.innerHTML = "➕ Crear Nuevo Presupuesto";
  modalBudgetRows = [];

  // Agregar 1 renglón inicial listo para usar
  if (appData?.catalogo && appData.catalogo.length > 0) {
    modalBudgetRows.push({
      ID_Item: appData.catalogo[0].ID_Item,
      Cantidad_Unidades: 1
    });
  } else {
    modalBudgetRows.push({
      ID_Item: "",
      Cantidad_Unidades: 1
    });
  }

  renderModalInvoiceRows();
  openModal("modalBudgetInvoice");
  setTimeout(() => {
    document.getElementById("modalBudgetName")?.focus();
  }, 100);
}

function openEditBudgetModal(scId) {
  modalBudgetScId = scId;
  const elId = document.getElementById("modalBudgetId");
  const elName = document.getElementById("modalBudgetName");
  const elGuests = document.getElementById("modalBudgetGuests");
  const elTitle = document.getElementById("modalBudgetTitle");

  if (elId) elId.value = scId;
  const allRows = (appData?.escenarios_rows || []).filter(r => r.ID_Escenario === scId);
  const scName = (allRows[0] && allRows[0].Nombre_Escenario) || scId;
  const guests = (allRows[0] && allRows[0].Invitados_Escenario) || (appData?.config?.Invitados_Base || 100);

  if (elName) elName.value = scName;
  if (elGuests) elGuests.value = guests;
  if (elTitle) elTitle.innerHTML = `✏️ Editar Presupuesto: <strong>${escapeHtml(scName)}</strong>`;

  modalBudgetRows = allRows
    .filter(r => r.ID_Item && String(r.ID_Item).trim() !== "")
    .map(r => ({
      ID_Item: r.ID_Item,
      Cantidad_Unidades: parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1
    }));

  renderModalInvoiceRows();
  openModal("modalBudgetInvoice");
}

function renderModalInvoiceRows() {
  const tbody = document.getElementById("tbodyModalInvoiceRows");
  if (!tbody) return;
  tbody.innerHTML = "";

  const guests = parseFloat(document.getElementById("modalBudgetGuests")?.value) || (appData?.config?.Invitados_Base || 100);

  // Build provider map: ID_Proveedor -> Nombre_Proveedor
  const provMap = new Map();
  (appData?.proveedores || []).forEach(p => {
    if (p && p.ID_Proveedor) {
      provMap.set(p.ID_Proveedor, p.Nombre_Proveedor || p.ID_Proveedor);
    }
  });

  (appData?.catalogo || []).forEach(c => {
    if (c && c.ID_Proveedor && !provMap.has(c.ID_Proveedor)) {
      provMap.set(c.ID_Proveedor, c.Nombre_Proveedor || c.ID_Proveedor);
    }
  });

  const provEntries = Array.from(provMap.entries());

  let totReal = 0, totNom = 0, totVes = 0;

  if (!modalBudgetRows || modalBudgetRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:32px 20px; color:var(--text-secondary);">
          <div style="font-size:24px; margin-bottom:6px;">🧾</div>
          <div style="font-weight:700; color:#1D1D1F; margin-bottom:4px;">No hay renglones en este presupuesto</div>
          <div style="font-size:12px; margin-bottom:12px;">Haz clic en el botón de abajo para agregar los productos o servicios cotizados.</div>
          <button type="button" class="btn btn-blue mini-btn" onclick="addModalInvoiceRow()">
            <span>➕</span> Agregar Primer Renglón
          </button>
        </td>
      </tr>
    `;
  } else {
    modalBudgetRows.forEach((row, idx) => {
      let item = (appData?.catalogo || []).find(c => c && c.ID_Item === row.ID_Item);
      if (!item) {
        const defaultProvId = row.ID_Proveedor || (provEntries[0] ? provEntries[0][0] : "");
        const defaultProvName = provMap.get(defaultProvId) || (provEntries[0] ? provEntries[0][1] : "Proveedor");
        item = {
          ID_Item: row.ID_Item || ("ITEM-" + (idx + 1)),
          ID_Proveedor: defaultProvId,
          Nombre_Proveedor: defaultProvName,
          Producto_Comparable: "Seleccionar producto...",
          Categoria: "General",
          Tipo_Cobro: "Fijo Global",
          Cantidad_Unidades: row.Cantidad_Unidades || 1,
          Precio_Unitario_Cotizado: 0,
          Moneda_Cotizada: "USD",
          Forma_Pago_Exigida: "USD Efectivo (Billetes)"
        };
      }

      const itemProvId = item.ID_Proveedor || (provEntries[0] ? provEntries[0][0] : "");
      const itemProvName = provMap.get(itemProvId) || item.Nombre_Proveedor || "Proveedor";

      const qty = parseFloat(row.Cantidad_Unidades) || 1;
      const price = parseFloat(item.Precio_Unitario_Cotizado) || 0;
      const c = calcItemCosts(
        item.Tipo_Cobro || "Fijo Global",
        qty,
        price,
        item.Moneda_Cotizada || "USD",
        item.Forma_Pago_Exigida || "USD Efectivo (Billetes)",
        guests
      );
      totReal += c.cReal;
      totNom += c.cNom;
      totVes += c.cVes;

      // Provider options: by ID_Proveedor
      let provOptions = "";
      if (provEntries.length === 0) {
        provOptions = `<option value="">(Sin proveedores registrados)</option>`;
      } else {
        provEntries.forEach(([pId, pName]) => {
          const isSel = (pId === itemProvId || pName === itemProvName);
          provOptions += `<option value="${escapeHtml(pId)}" ${isSel ? "selected" : ""}>${escapeHtml(pName)}</option>`;
        });
      }

      // Products options
      const prodsForProv = (appData?.catalogo || []).filter(c => c && (c.ID_Proveedor === itemProvId || c.Nombre_Proveedor === itemProvName));
      const pool = (prodsForProv.length > 0) ? prodsForProv : (appData?.catalogo || []);
      
      let prodOptions = "";
      if (pool.length > 0) {
        pool.forEach(p => {
          const isSel = (p.ID_Item === item.ID_Item);
          const priceStr = `${p.Moneda_Cotizada || "$"} ${parseFloat(p.Precio_Unitario_Cotizado) || 0}`;
          prodOptions += `<option value="${escapeHtml(p.ID_Item)}" ${isSel ? "selected" : ""}>${escapeHtml(p.Producto_Comparable || "Producto")} - ${priceStr}</option>`;
        });
      } else {
        prodOptions = `<option value="${escapeHtml(item.ID_Item)}" selected>${escapeHtml(item.Producto_Comparable || "Producto")}</option>`;
      }

      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid rgba(0,0,0,0.06)";

      tr.innerHTML = `
        <td style="text-align:center; font-weight:700; color:var(--text-secondary); padding:8px;">${idx + 1}</td>
        <td style="padding:6px 8px;">
          <select class="invoice-select modal-prov-select" style="font-size:12px; padding:6px 8px; width:100%; min-width:140px;" onchange="onModalRowProvChange(${idx}, this.value)">
            ${provOptions}
          </select>
        </td>
        <td style="padding:6px 8px;">
          <select class="invoice-select modal-prod-select" data-row-idx="${idx}" style="font-size:12px; padding:6px 8px; width:100%; min-width:200px;" onchange="onModalRowProdChange(${idx}, this.value)">
            ${prodOptions}
          </select>
          ${item.Detalle_Especificacion ? `<div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">${escapeHtml(item.Detalle_Especificacion)}</div>` : ""}
        </td>
        <td style="padding:6px 8px;">
          <div style="display:flex; flex-direction:column; gap:2px; align-items:flex-start;">
            <span class="cat-badge" style="font-size:10px; padding:2px 6px;">${escapeHtml(item.Categoria || "General")}</span>
            <span style="font-size:10px; color:#666;">${escapeHtml(item.Tipo_Cobro || "Fijo")} • ${escapeHtml(item.Forma_Pago_Exigida || "Efectivo")}</span>
          </div>
        </td>
        <td style="text-align:center; padding:6px 8px;">
          <input type="number" min="1" step="1" class="invoice-qty-input modal-qty-input" data-row-idx="${idx}" style="width:65px; font-size:12px; padding:4px 6px;"
                 value="${qty}" onchange="onModalRowQtyChange(${idx}, this.value)" />
        </td>
        <td style="text-align:right; font-weight:800; font-size:13px; color:#1D1D1F; padding:6px 8px;">
          ${formatUSD(c.cReal)}
        </td>
        <td style="text-align:right; color:var(--text-secondary); font-size:12px; padding:6px 8px;">
          ${formatVES(c.cVes)}
        </td>
        <td style="text-align:center; padding:6px 8px;">
          <button type="button" class="btn btn-secondary mini-btn-icon" style="color:#D32F2F;" onclick="removeModalInvoiceRow(${idx})" title="Quitar este renglón">
            🗑️
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  // Update Mini KPIs in Modal
  const ahorro = Math.max(0, totNom - totReal);
  const elReal = document.getElementById("modalKpiReal");
  const elVes = document.getElementById("modalKpiVes");
  const elNom = document.getElementById("modalKpiNom");
  const elAhorro = document.getElementById("modalKpiAhorro");

  if (elReal) elReal.textContent = formatUSD(totReal);
  if (elVes) elVes.textContent = formatVES(totVes);
  if (elNom) elNom.textContent = formatUSD(totNom);
  if (elAhorro) elAhorro.textContent = formatUSD(ahorro);
}

function recalculateModalBudgetCosts() {
  renderModalInvoiceRows();
}

function onModalRowProvChange(rowIdx, newProvId) {
  const row = modalBudgetRows[rowIdx];
  if (!row) return;
  row.ID_Proveedor = newProvId;
  const prods = (appData?.catalogo || []).filter(c => c && (c.ID_Proveedor === newProvId || c.Nombre_Proveedor === newProvId));
  if (prods.length > 0) {
    row.ID_Item = prods[0].ID_Item;
  } else {
    row.ID_Item = "";
  }
  renderModalInvoiceRows();
}

function onModalRowProdChange(rowIdx, newProdId) {
  const row = modalBudgetRows[rowIdx];
  if (!row) return;
  row.ID_Item = newProdId;
  renderModalInvoiceRows();
}

function onModalRowQtyChange(rowIdx, newQty) {
  const row = modalBudgetRows[rowIdx];
  if (!row) return;
  row.Cantidad_Unidades = parseFloat(newQty) || 1;
  renderModalInvoiceRows();
}

function addModalInvoiceRow() {
  if (!Array.isArray(modalBudgetRows)) modalBudgetRows = [];

  if (appData?.catalogo && appData.catalogo.length > 0) {
    const currentItemIds = new Set(modalBudgetRows.map(r => r.ID_Item));
    let candidate = appData.catalogo.find(c => c && !currentItemIds.has(c.ID_Item)) || appData.catalogo[0];
    modalBudgetRows.push({
      ID_Item: candidate.ID_Item,
      Cantidad_Unidades: 1
    });
  } else {
    modalBudgetRows.push({
      ID_Item: "",
      Cantidad_Unidades: 1
    });
  }

  renderModalInvoiceRows();
}

function removeModalInvoiceRow(rowIdx) {
  if (Array.isArray(modalBudgetRows)) {
    modalBudgetRows.splice(rowIdx, 1);
  }
  renderModalInvoiceRows();
}

async function saveModalBudgetAction() {
  try {
    const nameInput = document.getElementById("modalBudgetName");
    const name = (nameInput ? nameInput.value : "").trim();
    if (!name) {
      showToast("Por favor escribe un nombre para el presupuesto.", "warning");
      nameInput?.focus();
      return;
    }

    const guests = parseFloat(document.getElementById("modalBudgetGuests")?.value) || (appData?.config?.Invitados_Base || 100);

    // Sync rows from DOM to ensure immediate consistency
    const prodSelects = document.querySelectorAll("#tbodyModalInvoiceRows .modal-prod-select");
    const qtyInputs = document.querySelectorAll("#tbodyModalInvoiceRows .modal-qty-input");
    if (prodSelects.length > 0) {
      modalBudgetRows = [];
      prodSelects.forEach((sel, i) => {
        const prodId = sel.value;
        const qtyInp = qtyInputs[i];
        const qty = qtyInp ? (parseFloat(qtyInp.value) || 1) : 1;
        if (prodId) {
          modalBudgetRows.push({
            ID_Item: prodId,
            Cantidad_Unidades: qty
          });
        }
      });
    }

    const targetScId = modalBudgetScId || generateNextScenarioId();

    // Prepare scenario row objects
    const newRows = [];
    if (modalBudgetRows.length === 0) {
      newRows.push({
        ID_Escenario: targetScId,
        Nombre_Escenario: name,
        Invitados_Escenario: guests,
        ID_Item: "",
        Categoria: "",
        Producto_Comparable: "",
        Nombre_Proveedor: "",
        Detalle_Especificacion: "",
        Forma_Pago_Exigida: "",
        Cantidad_Unidades: 1,
        Subtotal_USD_Nominal: 0,
        Subtotal_USD_Real: 0,
        Subtotal_EUR_BCV: 0,
        Subtotal_VES: 0
      });
    } else {
      modalBudgetRows.forEach(r => {
        const item = (appData?.catalogo || []).find(c => c && c.ID_Item === r.ID_Item) || {};
        const provObj = (appData?.proveedores || []).find(p => p.ID_Proveedor === item.ID_Proveedor);
        const provName = provObj ? provObj.Nombre_Proveedor : (item.Nombre_Proveedor || item.ID_Proveedor || "");
        const qty = parseFloat(r.Cantidad_Unidades) || 1;
        const c = calcItemCosts(
          item.Tipo_Cobro || "Fijo Global",
          qty,
          item.Precio_Unitario_Cotizado || 0,
          item.Moneda_Cotizada || "USD",
          item.Forma_Pago_Exigida || "USD Efectivo (Billetes)",
          guests
        );
        newRows.push({
          ID_Escenario: targetScId,
          Nombre_Escenario: name,
          Invitados_Escenario: guests,
          ID_Item: r.ID_Item,
          Categoria: item.Categoria || "",
          Producto_Comparable: item.Producto_Comparable || "",
          Nombre_Proveedor: provName,
          Detalle_Especificacion: item.Detalle_Especificacion || "",
          Forma_Pago_Exigida: item.Forma_Pago_Exigida || "",
          Cantidad_Escenario: qty,
          Cantidad_Unidades: qty,
          Precio_Unitario: parseFloat(item.Precio_Unitario_Cotizado) || 0,
          Subtotal_USD_Nominal: c.cNom,
          Subtotal_USD_Real: c.cReal,
          Subtotal_USD_Binance: c.cBinance,
          Subtotal_EUR_BCV: c.cEur,
          Subtotal_VES: c.cVes
        });
      });
    }

    // 1. Inyectar inmediatamente en el array global
    if (!appData.escenarios_rows) appData.escenarios_rows = [];
    appData.escenarios_rows = appData.escenarios_rows.filter(x => x.ID_Escenario !== targetScId);
    appData.escenarios_rows.push(...newRows);

    // 2. Guardar en localStorage de respaldo
    syncAppDataToLocalStorage();

    // 3. Activar el escenario
    activeScenarioId = targetScId;

    // 4. Cerrar la ventana modal inmediatamente
    closeModal("modalBudgetInvoice");

    // 5. Re-renderizar toda la interfaz de inmediato sin esperar F5 ni red
    renderScenarioHistoryTable();
    populateScenarioDropdowns();
    renderSideBySideComparison();
    renderDashboard();
    updateSummaryPills();

    showToast("¡Presupuesto guardado y actualizado en pantalla!", "success");

    // 6. Asynchronously persist to Cloud Google Apps Script
    postDirectToGAS("save_scenario", "scenario", {
      ID_Escenario: targetScId,
      Nombre_Escenario: name,
      Invitados_Escenario: guests,
      items: modalBudgetRows.map(r => ({
        ID_Item: r.ID_Item,
        Cantidad_Escenario: parseFloat(r.Cantidad_Unidades) || 1,
        Cantidad_Unidades: parseFloat(r.Cantidad_Unidades) || 1
      }))
    });
  } catch (err) {
    console.error("[saveModalBudgetAction] Error:", err);
    showToast("⚠️ Ocurrió un error al procesar el presupuesto: " + err.message, "error");
    closeModal("modalBudgetInvoice");
  }
}

async function deleteScenarioById(scId) {
  if (!confirm(`¿Estás seguro de eliminar el presupuesto ${scId}? Esta acción no se puede deshacer.`)) return;

  // 1. Optimistic removal from global array
  appData.escenarios_rows = (appData.escenarios_rows || []).filter(r => r.ID_Escenario !== scId);
  try {
    localStorage.setItem("cached_escenarios_rows", JSON.stringify(appData.escenarios_rows));
  } catch (e) {}

  if (activeScenarioId === scId) {
    const remaining = getUniqueScenarios();
    activeScenarioId = remaining.length > 0 ? remaining[0].id : "ESC-01";
  }

  if (previewScenarioId === scId) {
    closeScenarioPreview();
  }

  // 2. Re-render UI immediately
  renderScenarioHistoryTable();
  populateScenarioDropdowns();
  renderSideBySideComparison();
  renderDashboard();
  updateSummaryPills();

  showToast("Presupuesto eliminado de la lista.", "success");

  // 3. Asynchronous delete in Cloud Google Apps Script
  postDirectToGAS("delete_scenario", "ID_Escenario", scId);
}

async function exportScenarioPdfById(scId) {
  const origActive = activeScenarioId;
  activeScenarioId = scId;
  await exportActiveScenarioPdf();
  activeScenarioId = origActive;
}

// ==========================================================================
// MODAL GLOBAL: VISTA COMPLETA (LIGHTBOX / DETALLE EXPANDIDO)
// ==========================================================================
function openFullDetailModal(type, id) {
  const modal = document.getElementById("modalFullDetailViewer");
  if (!modal) return;

  const badgeEl = document.getElementById("lightboxBadge");
  const titleEl = document.getElementById("lightboxTitle");
  const imgBox = document.getElementById("lightboxImageContainer");
  const gridEl = document.getElementById("lightboxDetailsGrid");
  const notesBox = document.getElementById("lightboxNotesBox");

  let photoUrl = "";
  let title = "";
  let badge = "";
  let gridItems = [];
  let notes = "";

  const cleanId = String(id || "").trim();

  if (type === "product") {
    const item = (appData.catalogo || []).find(c => String(c.ID_Item || "").trim() === cleanId);
    if (!item) {
      showToast("No se encontró el producto en el catálogo.", "warning");
      return;
    }
    photoUrl = getPhotoUrl(item.Ruta_Foto);
    title = item.Producto_Comparable || item.Categoria || "Producto";
    badge = "🏷️ Catálogo de Precios";
    
    const costs = calcItemCosts(item.Tipo_Cobro, item.Cantidad_Unidades, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, parseFloat(appData.config.Invitados_Base) || 100);
    gridItems = [
      { label: "ID Producto", val: item.ID_Item },
      { label: "Proveedor", val: item.Nombre_Proveedor || "No asignado" },
      { label: "Categoría", val: item.Categoria || "General" },
      { label: "Tipo de Cobro", val: item.Tipo_Cobro || "Fijo Global" },
      { label: "Precio Cotizado", val: `${formatNumber(item.Precio_Unitario_Cotizado || 0)} ${item.Moneda_Cotizada || 'USD'}` },
      { label: "Forma de Pago", val: item.Forma_Pago_Exigida || "No especificada" },
      { label: "Costo Binance (USDT)", val: formatUSD(costs.cReal) },
      { label: "Costo Nominal USD", val: formatUSD(costs.cNom) },
      { label: "Costo Estimado VES", val: formatVES(costs.cVes) }
    ];
    notes = `
      <div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">DETALLES Y ESPECIFICACIÓN TÉCNICA:</div>
      <div style="font-size:13px; color:#1D1D1F; line-height:1.5;">${escapeHtml(item.Detalle_Especificacion || "Sin especificaciones registradas.")}</div>
      ${item.Link_Referencia ? `<div style="margin-top:10px;"><a href="${escapeHtml(item.Link_Referencia)}" target="_blank" class="btn btn-secondary" style="font-size:12px; padding:4px 10px;">🌐 Ver Enlace de Referencia</a></div>` : ""}
    `;
  } else if (type === "provider") {
    const p = (appData.proveedores || []).find(x => String(x.ID_Proveedor || "").trim() === cleanId);
    if (!p) {
      showToast("No se encontró el proveedor.", "warning");
      return;
    }
    photoUrl = getPhotoUrl(p.Ruta_Foto);
    title = p.Nombre_Proveedor || "Proveedor";
    badge = "🏢 Directorio de Proveedores";

    gridItems = [
      { label: "ID Proveedor", val: p.ID_Proveedor },
      { label: "Rubro General", val: p.Rubro_General || "General" },
      { label: "Teléfono / Contacto", val: p.Telefono_Contacto || "Sin registrar" },
      { label: "Ubicación", val: p.Ubicacion || "No especificada" },
      { label: "¿Acepta BCV?", val: p.Acepta_BCV || "No" },
      { label: "Red Social / Web", val: p.Link_Red_Social ? `<a href="${escapeHtml(p.Link_Red_Social)}" target="_blank" style="color:var(--blue-primary);">${escapeHtml(p.Link_Red_Social)}</a>` : "Sin red social" }
    ];
    notes = `
      <div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">NOTAS DEL PROVEEDOR:</div>
      <div style="font-size:13px; color:#1D1D1F; line-height:1.5;">${escapeHtml(p.Notas_Proveedor || "Sin notas registradas.")}</div>
    `;
  } else if (type === "guest") {
    const inv = (appData.invitados || []).find(x => String(x.ID_Invitado || "").trim() === cleanId);
    if (!inv) {
      showToast("No se encontró el invitado.", "warning");
      return;
    }
    photoUrl = getPhotoUrl(inv.Ruta_Foto);
    title = inv.Nombre_Comp || inv.Nombre_Completo || "Invitado";
    badge = "👥 Lista de Invitados & Asistencia";

    const acomp = parseInt(inv.Acompanantes !== undefined ? inv.Acompanantes : inv.Acompanantes_Adicionales) || 0;
    const cleanTable = cleanMesaName(inv.Mesa_Asignada);
    const tableDisplay = cleanTable ? (cleanTable === "Principal" ? "👑 Principal" : "Mesa " + cleanTable) : "Sin mesa asignada";

    gridItems = [
      { label: "ID Invitado", val: inv.ID_Invitado },
      { label: "Rol / Grupo", val: inv.Rol_Cortejo || "Familia Novio" },
      { label: "Teléfono", val: inv.Telefono || "Sin teléfono" },
      { label: "Estado Asistencia", val: inv.Estado_Confirm || inv.Estado_Confirmacion || "Pendiente" },
      { label: "Acompañantes (+1)", val: `${acomp} (${1 + acomp} personas en total)` },
      { label: "Mesa Asignada", val: tableDisplay },
      { label: "Restricciones / Menú", val: inv.Restricciones_ || inv.Restricciones_Alimentarias || "Estándar" }
    ];
    notes = `
      <div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">NOTAS ADICIONALES:</div>
      <div style="font-size:13px; color:#1D1D1F; line-height:1.5;">${escapeHtml(inv.Notas || "Sin notas.")}</div>
    `;
  } else if (type === "task") {
    const t = (appData.tareas || []).find(x => String(x.ID_Tarea || "").trim() === cleanId);
    if (!t) {
      showToast("No se encontró la tarea.", "warning");
      return;
    }
    photoUrl = getPhotoUrl(t.Ruta_Foto);
    title = t.Titulo_Tarea || "Tarea Logística";
    badge = "📋 Logística & Tareas";

    const cleanDeadline = t.Fecha_Limite ? String(t.Fecha_Limite).trim().split("T")[0].split("-").reverse().join("/") : "Sin fecha";

    gridItems = [
      { label: "ID Tarea", val: t.ID_Tarea },
      { label: "Categoría", val: t.Categoria_Logistica || "General" },
      { label: "Responsable", val: t.Responsable || "Ambos" },
      { label: "Fecha Límite", val: cleanDeadline },
      { label: "Prioridad", val: t.Prioridad || "Media" },
      { label: "Estado Actual", val: t.Estado || "Pendiente" }
    ];
    notes = `
      <div style="font-size:12px; font-weight:700; color:var(--text-secondary); margin-bottom:4px;">NOTAS Y DETALLES:</div>
      <div style="font-size:13px; color:#1D1D1F; line-height:1.5;">${escapeHtml(t.Notas || "Sin notas adicionales.")}</div>
    `;
  }

  if (badgeEl) badgeEl.textContent = badge;
  if (titleEl) titleEl.textContent = title;

  if (imgBox) {
    if (photoUrl) {
      imgBox.innerHTML = `
        <img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(title)}" style="max-width:100%; max-height:360px; object-fit:contain; border-radius:12px; display:block; margin:0 auto;"
             onerror="this.parentElement.innerHTML='<div style=\\'padding:30px; color:#8E8E93; font-size:13px;\\'>⚠️ Imagen no disponible en la nube</div>';" />
      `;
    } else {
      imgBox.innerHTML = `
        <div style="padding:32px 20px; color:#8E8E93; text-align:center;">
          <div style="font-size:32px; margin-bottom:6px;">📷</div>
          <div style="font-size:13px; font-weight:600;">Sin fotografía o comprobante cargado</div>
        </div>
      `;
    }
  }

  if (gridEl) {
    gridEl.innerHTML = gridItems.map(item => `
      <div class="lightbox-detail-item">
        <div class="lightbox-label">${escapeHtml(item.label)}</div>
        <div class="lightbox-val">${item.val && String(item.val).includes("<a") ? item.val : escapeHtml(String(item.val || ""))}</div>
      </div>
    `).join("");
  }

  if (notesBox) notesBox.innerHTML = notes;
  openModal("modalFullDetailViewer");
}

// -------------------------------------------------------------
// 3. COMPARADOR CARA A CARA CON ANÁLISIS DE DIFERENCIAS Y ENCABEZADOS INTEGRADOS
// -------------------------------------------------------------
let sideBySideSc1 = "";
let sideBySideSc2 = "";
let sideBySideSc3 = "";

function onSideBySideColumnChange(colNum, val) {
  if (colNum === 1) sideBySideSc1 = val;
  else if (colNum === 2) sideBySideSc2 = val;
  else if (colNum === 3) sideBySideSc3 = val;
  renderSideBySideComparison();
}

function getScenarioOptionsHtml(selectedId, isOptional) {
  const uniqueScenarios = getUniqueScenarios();
  let html = "";
  if (isOptional) {
    html += `<option value="" ${!selectedId ? 'selected' : ''}>-- Ninguno (Comparar 2) --</option>`;
  }
  uniqueScenarios.forEach(sc => {
    const isSel = sc.id === selectedId ? "selected" : "";
    html += `<option value="${escapeHtml(sc.id)}" ${isSel}>${escapeHtml(sc.name)} (${escapeHtml(sc.id)})</option>`;
  });
  return html;
}

function renderSideBySideComparison() {
  const container = document.getElementById("sideBySideContainer");
  const diffCard = document.getElementById("diffAnalysisCard");
  const uniqueScenarios = getUniqueScenarios();

  if (uniqueScenarios.length === 0) {
    if (diffCard) diffCard.innerHTML = "";
    if (container) container.innerHTML = `<div style="text-align:center; padding:36px; color:var(--text-secondary);">No hay presupuestos creados aún. Haz clic en el botón <strong>"+ Crear Nuevo Presupuesto"</strong> arriba para comenzar.</div>`;
    return;
  }

  if (!sideBySideSc1 || !uniqueScenarios.some(s => s.id === sideBySideSc1)) {
    sideBySideSc1 = uniqueScenarios[0]?.id || "";
  }
  if (!sideBySideSc2 || !uniqueScenarios.some(s => s.id === sideBySideSc2)) {
    sideBySideSc2 = (uniqueScenarios.length > 1 ? uniqueScenarios[1]?.id : uniqueScenarios[0]?.id) || "";
  }
  if (sideBySideSc3 && !uniqueScenarios.some(s => s.id === sideBySideSc3)) {
    sideBySideSc3 = "";
  }

  const activeCols = [
    { num: 1, label: "Presupuesto A", id: sideBySideSc1, optional: false },
    { num: 2, label: "Presupuesto B", id: sideBySideSc2, optional: false },
    { num: 3, label: "Columna 3 (Opcional)", id: sideBySideSc3, optional: true }
  ];

  const compareIds = [sideBySideSc1, sideBySideSc2, sideBySideSc3].filter(Boolean);
  const guests = parseFloat(appData.config.Invitados_Base) || 100;

  // Compute metrics for each selected scenario
  const metricsMap = {};
  compareIds.forEach(id => {
    const allRows = appData.escenarios_rows.filter(r => r.ID_Escenario === id);
    const validRows = allRows.filter(r => r.ID_Item && String(r.ID_Item).trim() !== "");
    const name = (allRows[0] && allRows[0].Nombre_Escenario) || id;

    const scGuests = parseFloat(allRows[0]?.Invitados_Escenario) || guests;
    let totReal = 0, totNom = 0, totVes = 0, totEur = 0;
    let cashUsd = 0, usdt = 0, bcvVes = 0, marginal = 0, salonComida = 0;

    validRows.forEach(r => {
      const item = appData.catalogo.find(c => c.ID_Item === r.ID_Item) || r;
      const qty = parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1;
      const c = calcItemCosts(item.Tipo_Cobro, qty, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, scGuests);
      totReal += c.cReal;
      totNom += c.cNom;
      totVes += c.cVes;
      totEur += c.cEur;

      const f = item.Forma_Pago_Exigida || r.Forma_Pago_Exigida;
      if (f === "USD Efectivo (Billetes)") cashUsd += c.cReal;
      else if (f === "USDT / Binance") usdt += c.cReal;
      else if (f === "Bs a tasa BCV" || f === "Bs a tasa Dólar BCV" || f === "Bs a tasa Euro BCV") bcvVes += c.cVes;

      if (item.Tipo_Cobro === "Por Invitado") {
        const s = calcItemCosts("Por Invitado", 1, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, 1);
        marginal += s.cReal;
      }

      const cat = (item.Categoria || "").toLowerCase();
      if (cat.includes("espacio") || cat.includes("salón") || cat.includes("alimento") || cat.includes("catering") || cat.includes("comida")) {
        salonComida += c.cReal;
      }
    });

    const ahorroBrecha = Math.max(0, totNom - totReal);
    const pctPesados = totReal > 0 ? Math.round((salonComida / totReal) * 100) : 0;

    metricsMap[id] = { id, name, scGuests, rows: validRows, totReal, totNom, totVes, totEur, cashUsd, usdt, bcvVes, marginal, ahorroBrecha, pctPesados };
  });

  // Render Difference Analysis Banner and 5 KPIs at top
  if (diffCard) {
    if (compareIds.length >= 2) {
      const mA = metricsMap[compareIds[0]];
      const mB = metricsMap[compareIds[1]];
      const diffUSD = mB.totReal - mA.totReal;
      const diffVES = mB.totVes - mA.totVes;
      const absDiffUSD = Math.abs(diffUSD);
      const absDiffVES = Math.abs(diffVES);
      const pct = mA.totReal > 0 ? Math.round((absDiffUSD / mA.totReal) * 100) : 0;

      let bannerClass = "equal";
      let bannerIcon = "⚖️";
      let bannerTitle = "";
      let bannerSub = "";

      if (diffUSD > 0.01) {
        bannerClass = "expensive";
        bannerIcon = "🔺";
        bannerTitle = `El Presupuesto B (${escapeHtml(mB.name)}) es +${formatUSD(absDiffUSD)} (+${pct}%) MÁS COSTOSO que el Presupuesto A (${escapeHtml(mA.name)})`;
        bannerSub = `Representa una diferencia de ${formatVES(absDiffVES)} adicionales en bolívares.`;
      } else if (diffUSD < -0.01) {
        bannerClass = "cheaper";
        bannerIcon = "🟢";
        bannerTitle = `El Presupuesto B (${escapeHtml(mB.name)}) es -${formatUSD(absDiffUSD)} (-${pct}%) MÁS ECONÓMICO que el Presupuesto A (${escapeHtml(mA.name)})`;
        bannerSub = `¡Ahorro directo con Costo Binance! Te ahorras ${formatVES(absDiffVES)} en bolívares con la Opción B.`;
      } else {
        bannerClass = "equal";
        bannerIcon = "⚖️";
        bannerTitle = `Ambos presupuestos tienen exactamente el mismo Costo Binance: ${formatUSD(mA.totReal)}`;
        bannerSub = `La inversión requerida es idéntica en ambas opciones.`;
      }

      diffCard.innerHTML = `
        <div class="diff-banner ${bannerClass}">
          <div>
            <div class="diff-banner-title">
              <span>${bannerIcon}</span> ${bannerTitle}
            </div>
            <div class="diff-banner-sub">
              ${bannerSub}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; text-transform:uppercase; font-weight:700; opacity:0.8;">Brecha Neta</div>
            <div style="font-size:22px; font-weight:800;">${diffUSD >= 0 ? "+" : "-"}${formatUSD(absDiffUSD)}</div>
          </div>
        </div>

        <!-- Mini Comparativa de los 5 KPIs Cara a Cara -->
        <div class="diff-kpis-grid">
          <div class="diff-kpi-card">
            <div class="diff-kpi-title">Costo Binance (USDT)</div>
            <div class="diff-kpi-values">
              <div><strong style="color:#1D1D1F;">${formatUSD(mA.totReal)}</strong> <span style="font-size:10px; color:#888;">(A)</span></div>
              <div style="font-weight:700; color:${diffUSD > 0 ? '#E65100' : '#1B8738'};">${formatUSD(mB.totReal)} <span style="font-size:10px; color:#888;">(B)</span></div>
            </div>
          </div>
          <div class="diff-kpi-card">
            <div class="diff-kpi-title">Costo x Invitado</div>
            <div class="diff-kpi-values">
              <div><strong>${formatUSD(mA.scGuests > 0 ? mA.totReal / mA.scGuests : 0)}</strong></div>
              <div><strong>${formatUSD(mB.scGuests > 0 ? mB.totReal / mB.scGuests : 0)}</strong></div>
            </div>
          </div>
          <div class="diff-kpi-card">
            <div class="diff-kpi-title">Efectivo Billetes Exigido</div>
            <div class="diff-kpi-values">
              <div><strong style="color:#F57F17;">${formatUSD(mA.cashUsd)}</strong></div>
              <div><strong style="color:#F57F17;">${formatUSD(mB.cashUsd)}</strong></div>
            </div>
          </div>
          <div class="diff-kpi-card">
            <div class="diff-kpi-title">Ahorro Brecha BCV</div>
            <div class="diff-kpi-values">
              <div><strong style="color:#1B8738;">${formatUSD(mA.ahorroBrecha)}</strong></div>
              <div><strong style="color:#1B8738;">${formatUSD(mB.ahorroBrecha)}</strong></div>
            </div>
          </div>
          <div class="diff-kpi-card">
            <div class="diff-kpi-title">Salón + Comida (%)</div>
            <div class="diff-kpi-values">
              <div><strong>${mA.pctPesados}%</strong></div>
              <div><strong>${mB.pctPesados}%</strong></div>
            </div>
          </div>
        </div>
      `;
    } else {
      diffCard.innerHTML = "";
    }
  }

  // Determine which columns to show in table
  const renderedCols = activeCols.filter(col => !col.optional || col.id);
  // Also include the optional column if empty so the user can easily select it directly in the header!
  if (!renderedCols.some(c => c.num === 3)) {
    renderedCols.push(activeCols[2]);
  }

  // Build Side by Side HTML Table with Dropdowns DIRECTLY inside Column Headers
  let html = `<table class="side-by-side-table">`;
  
  // Headers (Dropdown Selectors + Scenario Totals)
  html += `<tr>`;
  renderedCols.forEach(col => {
    const m = col.id ? metricsMap[col.id] : null;
    html += `
      <th class="side-col-header" style="vertical-align:top; min-width:280px; padding:16px;">
        <div style="margin-bottom:12px; background:#FFFFFF; padding:10px 12px; border-radius:12px; border:1px solid #D1D1D6; box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <label style="display:block; font-size:11px; font-weight:800; text-transform:uppercase; color:var(--text-secondary); margin-bottom:6px;">
            ${escapeHtml(col.label)}
          </label>
          <select id="selectCompare${col.num}" class="form-select filter-select" style="font-weight:700; width:100%; font-size:13px; padding:6px 8px; cursor:pointer;" onchange="onSideBySideColumnChange(${col.num}, this.value)">
            ${getScenarioOptionsHtml(col.id, col.optional)}
          </select>
        </div>
        ${m ? `
          <div style="font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-weight:700;">Costo Binance (USDT)</div>
          <div style="font-size:26px; font-weight:800; color:#1D1D1F; margin:4px 0;">${formatUSD(m.totReal)}</div>
          <div style="font-size:12px; color:var(--text-secondary); font-weight:600;">${formatVES(m.totVes)} | ${formatEUR(m.totEur)}</div>
          <div style="font-size:11.5px; color:var(--text-secondary); margin-top:4px;">👥 ${m.scGuests} invitados • <strong>${formatUSD(m.scGuests > 0 ? m.totReal / m.scGuests : 0)}</strong> / inv</div>
        ` : `
          <div style="padding:20px 10px; text-align:center; color:var(--text-secondary); font-size:12px;">
            Selecciona un tercer presupuesto en el menú superior para comparar 3 opciones a la vez.
          </div>
        `}
      </th>
    `;
  });
  html += `</tr>`;

  // Block: 5 Financial KPIs Comparison
  html += `<tr>`;
  renderedCols.forEach(col => {
    const m = col.id ? metricsMap[col.id] : null;
    html += `
      <td class="side-col-kpis" style="vertical-align:top; padding:14px;">
        ${m ? `
          <div style="border-bottom:1px solid rgba(0,0,0,0.06); padding-bottom:10px; margin-bottom:10px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-secondary);">KPI 1: Costo x Invitado</div>
            <div style="font-size:15px; font-weight:700;">${formatUSD(m.scGuests > 0 ? m.totReal / m.scGuests : 0)}</div>
          </div>
          <div style="border-bottom:1px solid rgba(0,0,0,0.06); padding-bottom:10px; margin-bottom:10px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-secondary);">KPI 2: 1 Silla Más (Marginal)</div>
            <div style="font-size:15px; font-weight:700;">${formatUSD(m.marginal)}</div>
          </div>
          <div style="border-bottom:1px solid rgba(0,0,0,0.06); padding-bottom:10px; margin-bottom:10px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-secondary);">KPI 3: Efectivo Físico Exigido</div>
            <div style="font-size:15px; font-weight:700; color:#F57F17;">${formatUSD(m.cashUsd)}</div>
          </div>
          <div style="border-bottom:1px solid rgba(0,0,0,0.06); padding-bottom:10px; margin-bottom:10px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-secondary);">KPI 4: Ahorro Brecha BCV</div>
            <div style="font-size:15px; font-weight:700; color:#1B8738;">${formatUSD(m.ahorroBrecha)}</div>
          </div>
          <div>
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-secondary);">KPI 5: Salón + Comida</div>
            <div style="font-size:15px; font-weight:700; color:${m.pctPesados > 65 ? "#FF9500" : "#1D1D1F"};">${m.pctPesados}%</div>
          </div>
        ` : `
          <div style="padding:20px 10px; text-align:center; color:var(--text-secondary); font-size:12px;">-- Columna inactiva --</div>
        `}
      </td>
    `;
  });
  html += `</tr>`;

  // Block: Item Breakdown
  html += `<tr>`;
  renderedCols.forEach(col => {
    const m = col.id ? metricsMap[col.id] : null;
    let itemsList = "";
    if (m) {
      m.rows.forEach(r => {
        const item = appData.catalogo.find(c => c.ID_Item === r.ID_Item) || r;
        const qty = parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1;
        const c = calcItemCosts(item.Tipo_Cobro, qty, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, m.scGuests);
        const itemPhoto = getPhotoUrl(item.Ruta_Foto);
        const itemThumb = itemPhoto ? `
          <img src="${escapeHtml(itemPhoto)}" alt="Foto" class="thumbnail-clickable" style="width:32px; height:32px; object-fit:cover; border-radius:6px; border:1px solid #E5E5EA; flex-shrink:0; cursor:pointer;"
               onclick="openFullDetailModal('product', '${escapeHtml(item.ID_Item)}')" title="Ver detalle"
               onerror="this.style.display='none';" />
        ` : "";

        itemsList += `
          <div style="padding:8px 0; border-bottom:1px solid rgba(0,0,0,0.04); display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0;">
              ${itemThumb}
              <div style="min-width:0;">
                <div style="font-size:12px; font-weight:700; color:#1D1D1F; cursor:pointer;" onclick="openFullDetailModal('product', '${escapeHtml(item.ID_Item)}')">${escapeHtml(item.Producto_Comparable || "Producto")}</div>
                <div style="font-size:11px; color:var(--text-secondary);">${escapeHtml(item.Nombre_Proveedor || "")} (Cant: ${qty})</div>
              </div>
            </div>
            <div style="text-align:right; flex-shrink:0;">
              <div style="font-size:12px; font-weight:700; color:#1D1D1F;">${formatUSD(c.cReal)}</div>
              <div style="font-size:10px; color:var(--text-secondary);">${formatVES(c.cVes)}</div>
            </div>
          </div>
        `;
      });
    }

    html += `
      <td class="side-col-items" style="vertical-align:top; padding:14px;">
        ${m ? `
          <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px;">
            Ítems Incluidos (${m.rows.length})
          </div>
          ${itemsList || '<div style="font-size:12px; color:var(--text-secondary);">Sin ítems cargados en este presupuesto.</div>'}
        ` : `
          <div style="padding:20px 10px; text-align:center; color:var(--text-secondary); font-size:12px;">--</div>
        `}
      </td>
    `;
  });
  html += `</tr>`;

  html += `</table>`;
  if (container) container.innerHTML = html;
}

// PDF EXPORT FUNCTIONS
async function exportActiveScenarioPdf() {
  const allRows = appData.escenarios_rows.filter(r => r.ID_Escenario === activeScenarioId);
  const rows = allRows.filter(r => r.ID_Item && String(r.ID_Item).trim() !== "");
  const name = (allRows[0] && allRows[0].Nombre_Escenario) || activeScenarioId;
  const guests = parseFloat(allRows[0]?.Invitados_Escenario) || (parseFloat(appData.config.Invitados_Base) || 100);

  let totReal = 0, totNom = 0, totVes = 0;
  let itemsHtml = "";

  rows.forEach(r => {
    const item = appData.catalogo.find(c => c.ID_Item === r.ID_Item) || r;
    const qty = parseFloat(r.Cantidad_Escenario !== undefined && r.Cantidad_Escenario !== "" ? r.Cantidad_Escenario : r.Cantidad_Unidades) || 1;
    const c = calcItemCosts(item.Tipo_Cobro, qty, item.Precio_Unitario_Cotizado, item.Moneda_Cotizada, item.Forma_Pago_Exigida, guests);
    totReal += c.cReal;
    totNom += c.cNom;
    totVes += c.cVes;

    itemsHtml += `
      <tr style="border-bottom:1px solid #E5E5EA;">
        <td style="padding:10px 12px; font-size:13px; font-weight:bold;">${escapeHtml(item.Producto_Comparable || "")} (x${qty})</td>
        <td style="padding:10px 12px; font-size:13px;">${escapeHtml(item.Nombre_Proveedor || "")}</td>
        <td style="padding:10px 12px; font-size:13px;">${escapeHtml(item.Forma_Pago_Exigida || "")}</td>
        <td style="padding:10px 12px; font-size:13px; text-align:right; font-weight:bold;">${formatUSD(c.cReal)}</td>
        <td style="padding:10px 12px; font-size:13px; text-align:right;">${formatVES(c.cVes)}</td>
      </tr>
    `;
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Presupuesto - La Boda de Luis y Vane</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; color: #1D1D1F; }
        .header { border-bottom: 2px solid #F8BBD0; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; }
        .title { font-size: 26px; font-weight: 800; color: #D81B60; }
        .kpis { display: flex; gap: 16px; margin-bottom: 24px; }
        .kpi-box { flex: 1; background: #F9F9FB; border-radius: 12px; padding: 16px; border: 1px solid #E5E5EA; }
        .table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th { background: #F5F5F7; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #CCC; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="title">La Boda de Luis y Vane 💍</div>
          <div style="font-size:14px; color:#666; margin-top:4px;">Reporte Oficial de Presupuesto: <strong>${escapeHtml(name)}</strong></div>
        </div>
        <div style="text-align:right; font-size:12px; color:#777;">
          <div>Fecha de Boda: <strong>${appData.config.Fecha_Boda || "2027-06-15"}</strong></div>
          <div>Invitados Estimados: <strong>${guests}</strong></div>
          <div>Tasa USD BCV: <strong>${appData.config.Tasa_USD_BCV} Bs/$</strong> | Tasa Binance: <strong>${appData.config.Tasa_Binance || appData.config.Tasa_Efectivo_USDT} Bs/$</strong></div>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi-box">
          <div style="font-size:11px; text-transform:uppercase; color:#777; font-weight:bold;">Total Costo Binance (USDT)</div>
          <div style="font-size:26px; font-weight:800; color:#1D1D1F;">${formatUSD(totReal)}</div>
        </div>
        <div class="kpi-box">
          <div style="font-size:11px; text-transform:uppercase; color:#777; font-weight:bold;">Total Bolívares (VES)</div>
          <div style="font-size:22px; font-weight:700; color:#333;">${formatVES(totVes)}</div>
        </div>
        <div class="kpi-box">
          <div style="font-size:11px; text-transform:uppercase; color:#777; font-weight:bold;">Costo por Invitado</div>
          <div style="font-size:22px; font-weight:700; color:#333;">${formatUSD(guests > 0 ? totReal / guests : 0)}</div>
        </div>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>Producto / Ítem</th>
            <th>Proveedor</th>
            <th>Forma de Pago</th>
            <th style="text-align:right;">Subtotal Binance ($)</th>
            <th style="text-align:right;">Subtotal (Bs)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div style="margin-top:30px; font-size:11px; color:#888; text-align:center;">
        Generado automáticamente por el Sistema de Planificación "La Boda de Luis y Vane" • 100% Local & Privado
      </div>
    </body>
    </html>
  `;

  await triggerPdfDownload(html, `Presupuesto_${name.replace(/\s+/g, '_')}.pdf`);
}

async function exportSideBySidePdf() {
  const container = document.getElementById("sideBySideContainer");
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Comparativa de Presupuestos - La Boda de Luis y Vane</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 30px; color: #1D1D1F; }
        .header { border-bottom: 2px solid #F8BBD0; padding-bottom: 16px; margin-bottom: 20px; }
        .side-by-side-table { width: 100%; border-collapse: separate; border-spacing: 12px 0; }
        .side-col-header { background: #F9F9FB; border: 1px solid #CCC; padding: 16px; border-radius: 12px 12px 0 0; text-align: left; }
        .side-col-kpis { background: #FFFFFF; border: 1px solid #CCC; border-top: none; border-bottom: none; padding: 14px; }
        .side-col-items { background: #F9F9FB; border: 1px solid #CCC; border-top: none; border-radius: 0 0 12px 12px; padding: 14px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 style="color:#D81B60; margin:0 0 6px;">La Boda de Luis y Vane 💍</h1>
        <div style="font-size:14px; color:#666;">Comparativa Cara a Cara de Presupuestos (Tasas: BCV ${appData.config.Tasa_USD_BCV} Bs/$ | USDT ${appData.config.Tasa_Efectivo_USDT} Bs/$)</div>
      </div>
      ${container.innerHTML}
    </body>
    </html>
  `;

  await triggerPdfDownload(html, "Comparativa_Presupuestos_Boda.pdf");
}

async function triggerPdfDownload(html, filename) {
  showToast("Generando documento PDF en tu dispositivo...", "info");
  try {
    if (typeof html2pdf !== "undefined") {
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "794px";
      container.style.backgroundColor = "#ffffff";
      container.innerHTML = html;
      document.body.appendChild(container);

      const opt = {
        margin: [10, 10, 10, 10],
        filename: filename || "Comparativa_Presupuestos_Boda.pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
      };

      await html2pdf().set(opt).from(container).save();
      document.body.removeChild(container);
      showToast("¡PDF generado y descargado con éxito!", "success");
    } else {
      // Fallback: window.print()
      const win = window.open("", "_blank");
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    }
  } catch (err) {
    console.warn("Fallo html2pdf directo, activando respaldo de impresión:", err);
    try {
      const win = window.open("", "_blank");
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
      showToast("Se abrió la vista para guardar como PDF.", "info");
    } catch (e2) {
      showToast("Error generando PDF: " + err.message, "error");
    }
  }
}

// MODALS & CRUD
function openNewProviderModal() {
  document.getElementById("modalProviderTitle").textContent = "Nuevo Proveedor";
  document.getElementById("provId").value = "";
  document.getElementById("provNombre").value = "";
  document.getElementById("provRubro").value = "Otros";
  document.getElementById("provAceptaBcv").value = "No";
  document.getElementById("provTelefono").value = "";
  document.getElementById("provRedSocial").value = "";
  document.getElementById("provUbicacion").value = "";
  document.getElementById("provNotas").value = "";
  if (document.getElementById("provFotoRuta")) document.getElementById("provFotoRuta").value = "";
  if (document.getElementById("provFotoFile")) document.getElementById("provFotoFile").value = "";
  if (document.getElementById("provFotoPreview")) document.getElementById("provFotoPreview").innerHTML = "";
  updateCategoryControls();
  renderCategoryPills("quickRubroPills", "provRubro", getAllCategories());
  openModal("modalProvider");
}

function editProvider(id) {
  const p = appData.proveedores.find(x => x.ID_Proveedor === id);
  if (!p) return;
  document.getElementById("modalProviderTitle").textContent = "Editar Proveedor (" + id + ")";
  document.getElementById("provId").value = p.ID_Proveedor;
  document.getElementById("provNombre").value = p.Nombre_Proveedor || "";
  document.getElementById("provRubro").value = p.Rubro_General || "Otros";
  document.getElementById("provAceptaBcv").value = p.Acepta_BCV || "No";
  document.getElementById("provTelefono").value = p.Telefono_Contacto || "";
  document.getElementById("provRedSocial").value = p.Link_Red_Social || "";
  document.getElementById("provUbicacion").value = p.Ubicacion || "";
  document.getElementById("provNotas").value = p.Notas_Proveedor || "";
  if (document.getElementById("provFotoRuta")) document.getElementById("provFotoRuta").value = p.Ruta_Foto || "";
  if (document.getElementById("provFotoFile")) document.getElementById("provFotoFile").value = "";
  if (document.getElementById("provFotoPreview")) {
    if (p.Ruta_Foto) {
      const pUrl = getPhotoUrl(p.Ruta_Foto);
      if (pUrl) {
        document.getElementById("provFotoPreview").innerHTML = `
          <div class="photo-preview-wrap" style="position:relative; display:inline-block; margin-top:8px;">
            <img src="${escapeHtml(pUrl)}" style="width:70px;height:70px;object-fit:cover;border-radius:10px;border:1px solid #E5E5EA;"
                 onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
            <div style="display:none; width:70px; height:70px; border-radius:10px; border:1px solid #E5E5EA; background:#F2F2F7; align-items:center; justify-content:center; color:#8E8E93; font-size:12px;">📷 No disponible</div>
            <button type="button" class="btn-photo-remove" onclick="clearPhotoUpload('prov')" title="Eliminar fotografía">✕</button>
          </div>
        `;
      } else {
        document.getElementById("provFotoPreview").innerHTML = "";
      }
    } else {
      document.getElementById("provFotoPreview").innerHTML = "";
    }
  }
  updateCategoryControls();
  renderCategoryPills("quickRubroPills", "provRubro", getAllCategories());
  openModal("modalProvider");
}

async function saveProviderAction() {
  try {
    let pId = (document.getElementById("provId").value || "").trim();
    if (!pId) {
      pId = "PRV-" + String((appData.proveedores?.length || 0) + 1).padStart(2, "0");
    }
    const prov = {
      ID_Proveedor: pId,
      Nombre_Proveedor: (document.getElementById("provNombre").value || "").trim() || "Sin Nombre",
      Rubro_General: document.getElementById("provRubro").value || "Otros",
      Acepta_BCV: document.getElementById("provAceptaBcv").value || "No",
      Telefono_Contacto: (document.getElementById("provTelefono").value || "").trim(),
      Link_Red_Social: (document.getElementById("provRedSocial").value || "").trim(),
      Ubicacion: (document.getElementById("provUbicacion").value || "").trim(),
      Notas_Proveedor: (document.getElementById("provNotas").value || "").trim(),
      Ruta_Foto: document.getElementById("provFotoRuta")?.value || "",
      modulo: "Proveedores"
    };

    // Optimistic update in-memory and in localStorage
    if (!Array.isArray(appData.proveedores)) appData.proveedores = [];
    const idx = appData.proveedores.findIndex(x => x.ID_Proveedor === prov.ID_Proveedor);
    if (idx >= 0) {
      appData.proveedores[idx] = prov;
    } else {
      appData.proveedores.push(prov);
    }
    syncAppDataToLocalStorage();
    renderProviders();
    try {
      if (typeof populateCategoryDropdown === "function") {
        populateCategoryDropdown();
      }
    } catch (e) {
      console.warn("populateCategoryDropdown warning:", e);
    }
    showToast("Proveedor guardado con éxito.", "success");

    // Push to Cloud Google Apps Script
    postDirectToGAS("save_provider", "provider", prov);
  } catch (err) {
    console.error("[saveProviderAction] Error:", err);
    showToast("⚠️ Ocurrió un error al procesar el proveedor: " + err.message, "error");
  } finally {
    closeModal("modalProvider");
  }
}

function openNewItemModal() {
  populateProviderSelect();
  document.getElementById("modalItemTitle").textContent = "Nuevo Producto en Catálogo";
  document.getElementById("itemId").value = "";
  document.getElementById("itemComparable").value = "";
  document.getElementById("itemCategoria").value = "Otros";
  document.getElementById("itemDetalle").value = "";
  document.getElementById("itemTipoCobro").value = "Fijo Global";
  document.getElementById("itemCantidad").value = "1";
  document.getElementById("itemPrecio").value = "";
  document.getElementById("itemMoneda").value = "USD";
  document.getElementById("itemFormaPago").value = "USD Efectivo (Billetes)";
  document.getElementById("itemLinkRef").value = "";
  document.getElementById("itemFotoRuta").value = "";
  document.getElementById("itemFotoPreview").innerHTML = "";
  document.getElementById("itemFotoFile").value = "";
  updateCategoryControls();
  renderCategoryPills("quickItemCatPills", "itemCategoria", getAllCategories());
  openModal("modalItem");
}

function openNewItemForProvider(provId) {
  openNewItemModal();
  document.getElementById("itemProvId").value = provId;
}

function editItem(itemId) {
  const item = appData.catalogo.find(c => c.ID_Item === itemId);
  if (!item) return;
  populateProviderSelect();
  document.getElementById("modalItemTitle").textContent = "Editar Producto (" + itemId + ")";
  document.getElementById("itemId").value = item.ID_Item;
  document.getElementById("itemProvId").value = item.ID_Proveedor || "";
  document.getElementById("itemCategoria").value = item.Categoria || "Otros";
  document.getElementById("itemComparable").value = item.Producto_Comparable || "";
  document.getElementById("itemDetalle").value = item.Detalle_Especificacion || "";
  document.getElementById("itemTipoCobro").value = item.Tipo_Cobro || "Fijo Global";
  document.getElementById("itemCantidad").value = item.Cantidad_Unidades || 1;
  document.getElementById("itemPrecio").value = item.Precio_Unitario_Cotizado || "";
  document.getElementById("itemMoneda").value = item.Moneda_Cotizada || "USD";
  document.getElementById("itemFormaPago").value = item.Forma_Pago_Exigida || "USD Efectivo (Billetes)";
  document.getElementById("itemLinkRef").value = item.Link_Referencia || "";
  document.getElementById("itemFotoRuta").value = item.Ruta_Foto || "";
  document.getElementById("itemFotoFile").value = "";
  
  if (item.Ruta_Foto) {
    const pUrl = getPhotoUrl(item.Ruta_Foto);
    if (pUrl) {
      document.getElementById("itemFotoPreview").innerHTML = `
        <div class="photo-preview-wrap" style="position:relative; display:inline-block; margin-top:8px;">
          <img src="${escapeHtml(pUrl)}" style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid #E5E5EA;"
               onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" />
          <div style="display:none; width:80px; height:80px; border-radius:10px; border:1px solid #E5E5EA; background:#F2F2F7; align-items:center; justify-content:center; color:#8E8E93; font-size:12px;">📷 No disponible</div>
          <button type="button" class="btn-photo-remove" onclick="clearPhotoUpload('item')" title="Eliminar fotografía">✕</button>
        </div>
      `;
    } else {
      document.getElementById("itemFotoPreview").innerHTML = "";
    }
  } else {
    document.getElementById("itemFotoPreview").innerHTML = "";
  }
  updateCategoryControls();
  renderCategoryPills("quickItemCatPills", "itemCategoria", getAllCategories());
  openModal("modalItem");
}

function populateProviderSelect() {
  const sel = document.getElementById("itemProvId");
  sel.innerHTML = "";
  appData.proveedores.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.ID_Proveedor;
    opt.textContent = `${p.Nombre_Proveedor} (${p.Rubro_General})`;
    sel.appendChild(opt);
  });
}

function getPhotoUrl(ruta) {
  if (!ruta || typeof ruta !== "string") return "";
  const t = ruta.trim();
  if (!t) return "";

  // Convert Google Drive view/share/uc link to high-res thumbnail endpoint (incognito & cookie safe)
  if (t.includes("drive.google.com")) {
    const fileIdMatch = t.match(/\/d\/([a-zA-Z0-9_-]+)/) || t.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileIdMatch && fileIdMatch[1]) {
      return `https://drive.google.com/thumbnail?id=${fileIdMatch[1]}&sz=w1200`;
    }
  }

  if (t.startsWith("data:image/") || t.startsWith("http://") || t.startsWith("https://")) {
    return t;
  }
  if (t.startsWith("/") || t.startsWith("./")) {
    return t;
  }
  return "";
}

function renderCatalog() {
  if (currentViewingProviderId) {
    const prov = (appData?.proveedores || []).find(p => p.ID_Proveedor === currentViewingProviderId);
    if (prov) renderProviderDetailHeader(prov);
    renderProviderProductsTable(currentViewingProviderId);
  }
  renderProviders();
  renderComparableDropdown();
}

function compressImage(file, maxWidth = 800, maxHeight = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No se proporcionó ningún archivo"));
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("Error al decodificar la imagen"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error("Error al leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function clearPhotoUpload(type) {
  const fileInput = document.getElementById(`${type}FotoFile`);
  const rutaInput = document.getElementById(`${type}FotoRuta`);
  const previewDiv = document.getElementById(`${type}FotoPreview`);
  if (fileInput) fileInput.value = "";
  if (rutaInput) rutaInput.value = "";
  if (previewDiv) previewDiv.innerHTML = "";
  showToast("Fotografía eliminada.", "info");
}

// Photo file upload handler con compresión Base64 (800px, 0.7 JPEG) para sincronización en Google Drive
document.addEventListener("change", async (e) => {
  if (e.target && (e.target.id === "itemFotoFile" || e.target.id === "provFotoFile" || e.target.id === "guestFotoFile" || e.target.id === "taskFotoFile")) {
    const targetId = e.target.id;
    const file = e.target.files[0];
    if (!file) return;

    let rutaInputId = "itemFotoRuta";
    let previewDivId = "itemFotoPreview";
    let labelModule = "Producto";
    let moduleKey = "item";

    if (targetId === "provFotoFile") {
      rutaInputId = "provFotoRuta";
      previewDivId = "provFotoPreview";
      labelModule = "Proveedor";
      moduleKey = "prov";
    } else if (targetId === "guestFotoFile") {
      rutaInputId = "guestFotoRuta";
      previewDivId = "guestFotoPreview";
      labelModule = "Invitado";
      moduleKey = "guest";
    } else if (targetId === "taskFotoFile") {
      rutaInputId = "taskFotoRuta";
      previewDivId = "taskFotoPreview";
      labelModule = "Tarea Logística";
      moduleKey = "task";
    }

    try {
      showToast(`Comprimiendo fotografía de ${labelModule} (máx 800px, 0.7 JPEG)...`, "info");
      const compressedBase64 = await compressImage(file, 800, 800, 0.7);
      const rutaInput = document.getElementById(rutaInputId);
      if (rutaInput) rutaInput.value = compressedBase64;

      const previewDiv = document.getElementById(previewDivId);
      if (previewDiv) {
        previewDiv.innerHTML = `
          <div style="display:flex; align-items:center; gap:12px; margin-top:8px;">
            <div class="photo-preview-wrap" style="position:relative; display:inline-block;">
              <img src="${compressedBase64}" style="width:75px; height:75px; object-fit:cover; border-radius:10px; border:1px solid #E5E5EA;" />
              <button type="button" class="btn-photo-remove" onclick="clearPhotoUpload('${moduleKey}')" title="Eliminar fotografía antes de guardar">✕</button>
            </div>
            <div>
              <div style="font-size:12px; color:#1B8738; font-weight:700;">✨ Fotografía lista para subir</div>
              <div style="font-size:11px; color:var(--text-secondary);">Presiona "✕" si deseas descartarla</div>
            </div>
          </div>
        `;
      }
      showToast(`Fotografía de ${labelModule} lista para subir a Google Drive.`, "success");
    } catch (err) {
      console.error("Error procesando foto:", err);
      showToast("Error procesando foto: " + err.message, "error");
    }
  }
});

async function saveItemAction() {
  try {
    let itemId = (document.getElementById("itemId").value || "").trim();
    if (!itemId) {
      itemId = "CAT-" + String((appData.catalogo?.length || 0) + 1).padStart(2, "0");
    }
    const provId = (document.getElementById("itemProvId")?.value || "").trim();
    const provObj = (appData?.proveedores || []).find(p => p.ID_Proveedor === provId);

    const item = {
      ID_Item: itemId,
      ID_Proveedor: provId,
      Nombre_Proveedor: provObj ? provObj.Nombre_Proveedor : "",
      Categoria: document.getElementById("itemCategoria")?.value || "General",
      Producto_Comparable: (document.getElementById("itemComparable")?.value || "").trim() || "Varios",
      Detalle_Especificacion: (document.getElementById("itemDetalle")?.value || "").trim(),
      Tipo_Cobro: document.getElementById("itemTipoCobro")?.value || "Fijo Global",
      Cantidad_Unidades: parseFloat(document.getElementById("itemCantidad")?.value) || 1,
      Precio_Unitario_Cotizado: parseFloat(document.getElementById("itemPrecio")?.value) || 0,
      Moneda_Cotizada: document.getElementById("itemMoneda")?.value || "USD",
      Forma_Pago_Exigida: document.getElementById("itemFormaPago")?.value || "USD Efectivo (Billetes)",
      Link_Referencia: (document.getElementById("itemLinkRef")?.value || "").trim(),
      Ruta_Foto: document.getElementById("itemFotoRuta")?.value || "",
      modulo: "Productos"
    };

    // Optimistic update in-memory and in localStorage
    if (!Array.isArray(appData.catalogo)) appData.catalogo = [];
    const idx = appData.catalogo.findIndex(x => x?.ID_Item === item.ID_Item);
    if (idx >= 0) {
      appData.catalogo[idx] = item;
    } else {
      appData.catalogo.push(item);
    }
    syncAppDataToLocalStorage();
    renderCatalog();
    try {
      if (typeof populateCategoryDropdown === "function") {
        populateCategoryDropdown();
      }
    } catch (e) {
      console.warn("populateCategoryDropdown warning:", e);
    }
    showToast("Producto guardado con éxito.", "success");

    // Push to Cloud Google Apps Script
    postDirectToGAS("save_item", "item", item);
  } catch (err) {
    console.error("[saveItemAction] Error:", err);
    showToast("⚠️ Ocurrió un error al procesar el producto: " + err.message, "error");
  } finally {
    closeModal("modalItem");
  }
}

function openNewScenarioModal() {
  openNewBudgetModal();
}

async function deleteActiveScenario() {
  if (activeScenarioId) {
    await deleteScenarioById(activeScenarioId);
  }
}

async function createAutoMinBudget() {
  showToast("Calculando combinación de costo mínimo...", "info");
  const items = appData.catalogo || [];
  if (items.length === 0) {
    showToast("No hay productos en el catálogo para armar el presupuesto.", "warning");
    return;
  }

  // Group items by category or comparable name
  const groups = {};
  items.forEach(it => {
    const key = (it.Producto_Comparable && it.Producto_Comparable.trim()) || it.Categoria || "Varios";
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  });

  const selectedItems = [];
  const guests = appData.config?.invitados || 100;

  for (const key in groups) {
    const list = groups[key];
    let minItem = list[0];
    let minPrice = Infinity;
    list.forEach(it => {
      const p = parseFloat(it.Precio_Unitario_Cotizado) || 0;
      if (p < minPrice) {
        minPrice = p;
        minItem = it;
      }
    });
    if (minItem) {
      selectedItems.push({
        ID_Item: minItem.ID_Item,
        Cantidad_Unidades: parseFloat(minItem.Cantidad_Unidades) || 1
      });
    }
  }

  const scId = "ESC-MIN";
  const scName = "Presupuesto Mínimo Viable (Automático)";

  if (!Array.isArray(appData.escenarios_rows)) appData.escenarios_rows = [];
  appData.escenarios_rows = appData.escenarios_rows.filter(r => r.ID_Escenario !== scId);
  selectedItems.forEach(it => {
    appData.escenarios_rows.push({
      ID_Escenario: scId,
      Nombre_Escenario: scName,
      Invitados_Escenario: guests,
      ID_Item: it.ID_Item,
      Cantidad_Unidades: it.Cantidad_Unidades
    });
  });

  syncAppDataToLocalStorage();
  activeScenarioId = scId;
  renderScenarioHistoryTable();
  populateScenarioDropdowns();
  renderSideBySideComparison();
  renderDashboard();
  updateSummaryPills();

  showToast("Presupuesto Mínimo Viable (ESC-MIN) generado con éxito.", "success");

  // Push to Cloud Google Apps Script
  postDirectToGAS("save_scenario", "scenario", {
    ID_Escenario: scId,
    Nombre_Escenario: scName,
    Invitados_Escenario: guests,
    items: selectedItems
  });
}

// Helpers
function handleSaveResponse(json) {
  if (json.error === "excel_locked") {
    openModal("modalExcelLocked");
  } else if (!json.success) {
    showToast(json.message || "Error al procesar la operación.", "error");
  } else {
    notifyCloudSyncStart();
  }
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("active");
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  window.lastToastMessage = { msg, type, time: Date.now() };

  const t = document.createElement("div");
  let icon = "ℹ️";
  let cls = "toast";
  let duration = 4500;

  if (type === "error") {
    cls += " toast-error";
    icon = "❌";
    duration = 10000;
    console.error("[Toast Error]:", msg);
  } else if (type === "success") {
    cls += " toast-success";
    icon = "✅";
    duration = 4500;
  } else if (type === "warning") {
    cls += " toast-warning";
    icon = "⚠️";
    duration = 7500;
    console.warn("[Toast Warning]:", msg);
  }

  t.className = cls;
  t.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${escapeHtml(msg)}</span>
    <button type="button" class="toast-close" title="Cerrar notificación" onclick="event.stopPropagation(); this.closest('.toast').remove();">&times;</button>
  `;
  container.appendChild(t);

  let timer = setTimeout(() => {
    t.style.opacity = "0";
    setTimeout(() => {
      if (t.parentNode === container) container.removeChild(t);
    }, 300);
  }, duration);

  t.addEventListener("click", () => {
    // Si el usuario hace clic en el toast, cancelamos la desaparición para que pueda leerlo con calma
    clearTimeout(timer);
  });
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Exportaciones globales para garantizar funcionamiento 100% libre de ReferenceError
window.cleanMesaName = cleanMesaName;
window.getTableOptionsHtml = getTableOptionsHtml;
window.onGuestTableChange = onGuestTableChange;
window.toggleGuestGroupTables = toggleGuestGroupTables;
window.editGuest = editGuest;
window.deleteGuestAction = deleteGuestAction;
window.openNewGuestModal = openNewGuestModal;
window.saveGuestAction = saveGuestAction;
window.syncGuestsCountToConfig = syncGuestsCountToConfig;
window.fetchGuestsFromGAS = fetchGuestsFromGAS;
window.syncFromGASDirect = syncFromGASDirect;
window.connectAndSyncCloud = connectAndSyncCloud;
window.triggerCloudSyncHeader = triggerCloudSyncHeader;
window.adjustGuests = adjustGuests;
window.syncBcvRates = syncBcvRates;
window.createAutoMinBudget = createAutoMinBudget;
window.applyComparablePreset = applyComparablePreset;
window.renderTripleComparison = renderTripleComparison;
window.openNewBudgetModal = openNewBudgetModal;
window.closeScenarioPreview = closeScenarioPreview;
window.exportSideBySidePdf = exportSideBySidePdf;
window.closeModal = closeModal;
window.openModal = openModal;
window.saveProviderAction = saveProviderAction;
window.saveItemAction = saveItemAction;
window.recalculateModalBudgetCosts = recalculateModalBudgetCosts;
window.addModalInvoiceRow = addModalInvoiceRow;
window.saveModalBudgetAction = saveModalBudgetAction;
window.saveTaskAction = saveTaskAction;
window.sortTasks = sortTasks;
window.openNewProviderModal = openNewProviderModal;
window.backToProvidersList = backToProvidersList;
window.openNewItemForCurrentProvider = openNewItemForCurrentProvider;
window.openNewTaskModal = openNewTaskModal;
window.cloudConfig = cloudConfig;
window.appData = appData;
window.showToast = showToast;
window.updateGuestInline = updateGuestInline;
window.updateTaskInline = updateTaskInline;
window.openCategoriesManagerModal = openCategoriesManagerModal;
window.renderCategoriesManagerList = renderCategoriesManagerList;
window.addNewCategoryAction = addNewCategoryAction;
window.renameCategoryAction = renameCategoryAction;
window.deleteCategoryAction = deleteCategoryAction;
window.triggerAsanaNormalization = triggerAsanaNormalization;
window.filterComparatorProducts = filterComparatorProducts;
window.recalculateComparatorMultipliers = recalculateComparatorMultipliers;
window.openTooltipModal = openTooltipModal;
window.closeTooltipModal = closeTooltipModal;
window.openManual = openManual;
window.openEditBudgetModal = openEditBudgetModal;
window.deleteScenarioById = deleteScenarioById;
