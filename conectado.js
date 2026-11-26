// =====================================================================
// miescuela.com · Modo con cuentas (Supabase)
// Inicio de sesión y vistas por rol: alumno, padre, profesor y administración.
// Los permisos los aplica la base de datos (ver supabase.sql): cada quien recibe solo lo suyo.
// =====================================================================
'use strict';

// ---------- Acceso a datos ----------
const correoDe = u => `${String(u).trim().toLowerCase()}@escuela.test`;
const SB = {cli: null, async iniciar() {
  if (this.cli) return this.cli;
  if (!window.supabase) await new Promise((ok, mal) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar Supabase. Revisa tu internet.')); document.head.appendChild(s); });
  this.cli = window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.clave);
  return this.cli;
}};
const URLS = new Map();
// ---------- Archivos: se guardan como Facebook guarda sus fotos ----------
// 1) Las fotos se reducen (máximo 1600 px, formato WebP) antes de subirlas: pesan de 5 a 10 veces menos y se ven igual en pantalla.
// 2) Cada archivo se guarda con su huella (SHA-256) como nombre: si se manda dos veces el mismo, se guarda una sola vez.
const ARCHIVOS = {
  async huella(b) { const h = await crypto.subtle.digest('SHA-256', await b.arrayBuffer()); return [...new Uint8Array(h)].slice(0, 16).map(x => x.toString(16).padStart(2, '0')).join(''); },
  async optimizar(f) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type || '')) return f;
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      if (k === 1 && f.size < 400 * 1024) return f;
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const b = await new Promise(ok => c.toBlob(ok, 'image/webp', 0.82));
      return b && b.size < f.size ? new File([b], f.name.replace(/\.\w+$/, '') + '.webp', {type: 'image/webp'}) : f;
    } catch { return f; }
  },
  // Sube a bucket/carpeta/<huella>.<ext> y devuelve la ruta y el archivo ya optimizado.
  async guardar(bucket, carpeta, f) {
    f = await this.optimizar(f);
    const ext = ((f.name || '').match(/\.(\w+)$/) || [, (f.type || '').split('/')[1] || 'bin'])[1].toLowerCase();
    const ruta = `${carpeta}/${await this.huella(f)}.${ext}`;
    await db().subir(bucket, ruta, f);
    return {ruta, archivo: f};
  }
};
window.ARCHIVOS = ARCHIVOS;
const LLAVES = {asistencia: ['grupo_id', 'fecha', 'alumno_id'], inscripciones: ['grupo_id', 'alumno_id'], entregas: ['tarea_id', 'alumno_id'], tutores: ['padre_id', 'alumno_id'], avisos_leidos: ['aviso_id', 'persona_id'],
  capturas: ['grupo_id', 'alumno_id', 'rubro', 'periodo'], historial: ['alumno_id', 'ciclo', 'clave'], formas_calificar: ['grupo_id']};
function crearDBReal() {
  const filtrar = (q, f) => { for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) q = q.in(k, v); else if (v && typeof v === 'object' && 'desde' in v) q = q.gte(k, v.desde); else if (v === null) q = q.is(k, null); else q = q.eq(k, v); } return q; };
  const ok = ({data, error}) => { if (error) throw error; return data; };
  return {
    async sesion() { const c = await SB.iniciar(); const {data} = await c.auth.getSession(); return data.session?.user?.id || null; },
    async entrar(u, p) { const c = await SB.iniciar(); const {data, error} = await c.auth.signInWithPassword({email: correoDe(u), password: p}); if (error) throw error; return data.user.id; },
    async salir() { const c = await SB.iniciar(); await c.auth.signOut(); },
    // Supabase entrega máximo 1000 filas por consulta: se piden por partes hasta tenerlas todas.
    async leer(t, f = {}, o = {}) { if (Object.values(f).some(v => Array.isArray(v) && !v.length)) return []; const c = await SB.iniciar();
      const llave = LLAVES[t] || ['id'];   // orden fijo para que las partes no se repitan ni se salten filas
      const consulta = () => { let q = filtrar(c.from(t).select('*'), f); if (o.orden) q = q.order(o.orden, {ascending: !o.desc}); for (const k of llave) if (k !== o.orden) q = q.order(k); return q; };
      if (o.limite) return ok(await consulta().limit(o.limite));
      const todo = []; for (let i = 0; ; i += 1000) { const parte = ok(await consulta().range(i, i + 999)); todo.push(...parte); if (parte.length < 1000) return todo; } },
    async insertar(t, filas) { const c = await SB.iniciar(); return ok(await c.from(t).insert(filas).select()); },
    async upsert(t, filas, conflicto) { const c = await SB.iniciar(); return ok(await c.from(t).upsert(filas, {onConflict: conflicto}).select()); },
    async actualizar(t, cambios, f) { const c = await SB.iniciar(); return ok(await filtrar(c.from(t).update(cambios), f).select()); },
    async borrar(t, f) { const c = await SB.iniciar(); return ok(await filtrar(c.from(t).delete(), f)); },
    // Si el mismo archivo ya está guardado (misma huella), no se vuelve a subir.
    async subir(b, ruta, archivo) { const c = await SB.iniciar(); const {error} = await c.storage.from(b).upload(ruta, archivo, {upsert: false, contentType: archivo.type || undefined}); if (error && !/exist|duplicate/i.test(error.message || '')) throw error; },
    // Los enlaces de los archivos duran 1 hora; se reusan mientras sigan vigentes en lugar de pedir uno nuevo cada vez.
    async url(b, ruta) { const k = b + '/' + ruta, x = URLS.get(k); if (x && x.vence > Date.now() + 300000) return x.url;
      const c = await SB.iniciar(); const {data, error} = await c.storage.from(b).createSignedUrl(ruta, 3600); if (error) throw error; URLS.set(k, {url: data.signedUrl, vence: Date.now() + 3600000}); return data.signedUrl; },
    // ¿Ya se corrió supabase.sql? Devuelve cuántas cuentas hay, o null si la base está vacía.
    async diagnostico() { const c = await SB.iniciar(); const {data, error} = await c.rpc('estado_demo'); return error ? null : data; }
  };
}
const conCuentas = () => !!(window.__DB_PRUEBA__ || (window.CONFIG?.supabase?.url && CONFIG.supabase.clave));
let DB = null;
const db = () => DB || (DB = window.__DB_PRUEBA__ || crearDBReal());

// ---------- Estado y utilidades ----------
const C = {yo: null, cache: {}};
const NIVELES = {kinder: 'Kinder', primaria: 'Primaria', secundaria: 'Secundaria', bachillerato: 'Bachillerato', universidad: 'Universidad'};
const DIAS_C = ['Dom', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const deIso = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fCorta2 = s => { const d = deIso(s); return `${d.getDate()} ${MESES_C[d.getMonth()]}`; };
const fLarga = s => { const d = deIso(s); return `${DIAS_C[d.getDay()]} ${d.getDate()} ${MESES_C[d.getMonth()]}`; };
const hora = ts => { const d = new Date(ts); return `${d.getDate()}/${d.getMonth() + 1} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hace = (dias) => { const d = new Date(); d.setDate(d.getDate() - dias); return iso(d); };
const horarioTxt = g => (g.horario || []).map(h => `${DIAS_C[h.dia].slice(0, 3)} ${h.inicio}–${h.fin}`).join(' · ') || 'Sin horario';
const hayClase = (g, d) => (g.horario || []).some(h => h.dia === (d.getDay() || 7) || (h.dia === 7 && d.getDay() === 0));
const ultimaClaseDe = g => { const d = new Date(); for (let i = 0; i < 14; i++) { if (hayClase(g, d)) return iso(d); d.setDate(d.getDate() - 1); } return iso(new Date()); };
const iniciales = n => String(n).split(' ').filter(x => x && !/\./.test(x)).slice(0, 2).map(x => x[0]).join('').toUpperCase();
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const TIPOS_NOTA = {fortaleza: ['Fortaleza', 'ok'], reforzar: ['A reforzar', 'aviso'], conducta: ['Conducta', 'mal'], salud: ['Salud', ''], general: ['General', '']};
const cargando = () => `<div class="vacio">${ic('reloj')}Cargando…</div>`;
const fallo = e => `<div class="vacio" style="color:var(--mal)">${ic('cerrar')}No se pudo cargar: ${esc(e.message || String(e))}</div>`;
const porId = arr => Object.fromEntries(arr.map(x => [x.id, x]));
const main = () => document.querySelector('main');

// ---------- Inicio de sesión ----------
const CUENTAS_DEMO = [
  ['Alumnos (Pedro en cada etapa)', [['pedro.primaria', 'Primaria'], ['pedro.secundaria', 'Secundaria'], ['pedro.bachillerato', 'Bachillerato'], ['12345678', 'Universidad']]],
  ['Papás (mamá de Pedro)', [['mama.kinder', 'Kinder'], ['mama.secundaria', 'Secundaria'], ['mama.bachillerato', 'Bachillerato']]],
  ['Profesores', [['prof.kinder', 'Kinder'], ['prof.primaria', 'Primaria'], ['prof.secundaria', 'Secundaria'], ['prof.bachillerato', 'Bachillerato'], ['prof.universidad', 'Universidad']]],
  ['Escuela', [['admin', 'Administración']]]
];
function vistaEntrar(msg) {
  document.getElementById('raiz').innerHTML = `
  <div class="login"><form id="fe" style="max-width:460px">
   <div class="logo"><b>me</b><span>miescuela.com</span></div>
   <div><h1 style="font-size:24px">Portal escolar</h1><p style="margin:4px 0 0;color:var(--gris);font-size:14px">Entra con tu usuario o matrícula. La página te lleva a lo tuyo según seas alumno, papá, profesor o administración.</p></div>
   <label>Usuario o matrícula<input id="eu" autocomplete="username" autocapitalize="none" required></label>
   <label>Contraseña<input id="ep" type="password" autocomplete="current-password" required></label>
   <button class="btn" type="submit" id="eb">Entrar</button>
   <p id="eerr" role="alert" style="margin:0;color:var(--mal);font-size:13px">${msg ? esc(msg) : ''}</p>
   <div class="cuentas-demo"><b>Cuentas de prueba</b><span>Toca una y entras directo. Si prefieres escribirla, la contraseña de todas es <code>Demo2026</code>.</span>
    ${CUENTAS_DEMO.map(([g, cs]) => `<small>${g}</small><div>${cs.map(([u, t]) => `<button type="button" data-u="${u}">${t}</button>`).join('')}</div>`).join('')}
   </div>
   <a href="#inicio" style="font-size:13px;text-align:center">Ver la demostración sin cuenta</a>
   <p class="aviso-proto">Prototipo · todas las personas y datos son ficticios</p>
  </form></div>`;
  const f = document.getElementById('fe');
  f.onclick = e => { const b = e.target.closest('[data-u]'); if (b) { f.querySelector('#eu').value = b.dataset.u; f.querySelector('#ep').value = 'Demo2026'; f.requestSubmit(); } };
  f.onsubmit = async e => {
    e.preventDefault(); const b = f.querySelector('#eb'), err = f.querySelector('#eerr'); b.disabled = true; b.textContent = 'Entrando…'; err.textContent = '';
    try { await db().entrar(f.querySelector('#eu').value, f.querySelector('#ep').value); C.yo = null; C.cache = {}; location.hash = '#c'; if (location.hash === '#c') pintarConectado('c'); }
    catch (x) {
      let msg = 'No se pudo entrar: ' + (x.message || x);
      if (/invalid/i.test(x.message || '')) { const n = db().diagnostico ? await db().diagnostico().catch(() => null) : 1;
        msg = !n ? 'La base de datos todavía no tiene las cuentas: falta pegar y correr supabase.sql en el SQL Editor de Supabase.' : 'Usuario o contraseña incorrectos.'; }
      err.textContent = msg; b.disabled = false; b.textContent = 'Entrar'; }
  };
}
async function quienSoy() {
  if (C.yo) return C.yo;
  const uid = await db().sesion(); if (!uid) return null;
  C.yo = (await db().leer('personas', {auth_id: uid}))[0] || null;
  return C.yo;
}

// ---------- Marco por rol ----------
function navDe(yo) {
  if (yo.rol === 'alumno') return [['c/inicio', 'Inicio', 'inicio'], ['c/tareas', yo.nivel === 'primaria' ? 'Mis tareas' : 'Tareas', 'act'], ...(yo.nivel === 'primaria' ? [] : [['c/mensajes', 'Mensajes', 'msg']])];
  if (yo.rol === 'padre') return [['c/hijo', 'Resumen', 'inicio'], ['c/hijo/mensajes', 'Mensajes', 'msg']];
  if (yo.rol === 'profesor') return [['c/grupos', 'Mis grupos', 'perfil'], ...(C.cache.misGrupos || []).map(g => [`c/g/${g.id}/lista`, g.nombre + (g.materia.startsWith('Grupo') ? '' : ' · ' + g.materia), 'lista'])];
  return [['c/admin', 'Resumen', 'tray'], ['c/admin/alumnos', 'Alumnos', 'perfil'], ['c/admin/grupos', 'Grupos', 'lista'], ['c/admin/calendario', 'Calendario escolar', 'cal'], ['c/admin/pagos', 'Pagos', 'pagos'], ['c/admin/avisos', 'Avisos', 'msg'], ['c/admin/profesores', 'Profesores', 'lista']];
}
function marcoC(ruta, titulo, html) {
  const yo = C.yo, nav = navDe(yo), clase = {profesor: 'prof', padre: 'padre', admin: 'admin', alumno: ''}[yo.rol];
  const activo = k => k === ruta || (ruta.startsWith('c/g/') && k.startsWith(ruta.split('/').slice(0, 3).join('/') + '/')) || (k === 'c/hijo' && ruta === 'c/hijo');
  const rolTxt = {alumno: `${NIVELES[yo.nivel] || ''} · ${yo.grado || ''}`, padre: yo.grado || 'Familia', profesor: `Profesor · ${NIVELES[yo.nivel] || ''}`, admin: 'Administración'}[yo.rol];
  const inf = yo.rol === 'admin' ? [nav[0], nav[2], nav[4]] : nav.slice(0, 3);
  document.getElementById('raiz').innerHTML = `
  <div class="app ${clase}">
   <aside class="lateral"><div class="logo"><b>me</b><span>miescuela.com</span></div>
    <nav class="nav"><div class="grupo">${{alumno: 'Escolar', padre: 'Familia', profesor: 'Docencia', admin: 'Administración'}[yo.rol]}</div>${nav.map(([k, t, i]) => `<a href="#${k}" class="${activo(k) ? 'activo' : ''}">${ic(i)}${esc(t)}</a>`).join('')}</nav>
    <a class="modo" href="#salir-c">${ic('salir')}Salir</a></aside>
   <div class="cuerpo">
    <header class="barra"><h1>${esc(titulo)}</h1><span class="yo"><span class="avatar">${iniciales(yo.nombre)}</span><span class="nom" style="font-size:14px;font-weight:600">${esc(yo.nombre)} · ${esc(rolTxt)}</span></span></header>
    <main>${html}</main>
   </div>
  </div>
  <nav class="inferior">${inf.map(([k, t, i]) => `<a href="#${k}" class="${activo(k) ? 'activo' : ''}">${ic(i)}${esc(t.length > 12 ? t.split(' ')[0] : t)}</a>`).join('')}<a href="#salir-c">${ic('salir')}Salir</a></nav>`;
  window.scrollTo(0, 0); document.title = titulo + ' · miescuela.com';
}

// ---------- Router ----------
async function pintarConectado(r) {
  if (!conCuentas()) { location.hash = '#inicio'; return; }
  if (r === 'salir-c') { try { await db().salir(); } catch {} C.yo = null; C.cache = {}; history.replaceState(null, '', '#entrar'); return vistaEntrar(); }
  let yo; try { yo = await quienSoy(); } catch (e) { return vistaEntrar('No se pudo conectar: ' + (e.message || e)); }
  if (r === 'entrar') { if (yo) { location.hash = '#c'; return; } return vistaEntrar(); }
  if (!yo) { history.replaceState(null, '', '#entrar'); return vistaEntrar(); }
  if (yo.rol === 'profesor' && !C.cache.misGrupos) C.cache.misGrupos = await db().leer('grupos', {profesor_id: yo.id}, {orden: 'id'});
  const casa = {alumno: 'c/inicio', padre: 'c/hijo', profesor: 'c/grupos', admin: 'c/admin'}[yo.rol];
  if (r === 'c') r = casa;
  const p = r.split('/');
  try {
    if (yo.rol === 'alumno') { if (r === 'c/tareas') return await vAlumnoTareas(); if (r === 'c/mensajes' && yo.nivel !== 'primaria') return await vMensajes('c/mensajes'); return await vAlumnoInicio(); }
    if (yo.rol === 'padre') { if (r === 'c/hijo/mensajes') return await vMensajes('c/hijo/mensajes'); return await vPadre(); }
    if (yo.rol === 'profesor') { if (p[1] === 'g' && C.cache.misGrupos.some(g => g.id === p[2])) return await vGrupo(p[2], p[3] || 'lista'); return await vProfGrupos(); }
    if (yo.rol === 'admin') { if (r === 'c/admin/alumnos') return await vAdminAlumnos(); if (r === 'c/admin/profesores') return await vAdminProfesores(); if (r === 'c/admin/avisos') return await vAdminAvisos(); if (r === 'c/admin/calendario') return await vAdminCalendario(); if (r === 'c/admin/grupos') return await vAdminGrupos(); if (r === 'c/admin/pagos') return await vAdminPagos(); return await vAdmin(); }
  } catch (e) { marcoC(r, 'Error', fallo(e)); }
}
window.pintarConectado = pintarConectado;

// ---------- Avisos (todos los roles) ----------
async function htmlAvisos(limite = 5) {
  const [avs, leidos] = await Promise.all([db().leer('avisos', {}, {orden: 'creado_en', desc: true, limite}), db().leer('avisos_leidos', {persona_id: C.yo.id})]);
  const vistos = new Set(leidos.map(l => l.aviso_id));
  if (!avs.length) return '';
  return `<section class="tarjeta"><div class="fila"><h2>Avisos de la escuela</h2></div><div class="lista">${avs.map(a => `<div class="it" style="align-items:flex-start"><div class="t"><b>${esc(a.titulo)}</b><span style="display:block;color:var(--tinta);font-size:14px;margin:2px 0">${esc(a.texto)}</span><span>${hora(a.creado_en)}${a.nivel ? ' · ' + NIVELES[a.nivel] : ' · Para todos'}</span></div>${vistos.has(a.id) ? '<span class="chip ok">Enterado</span>' : `<button class="btn" data-enterado-c="${a.id}" style="padding:8px 12px;font-size:13px">Enterado</button>`}</div>`).join('')}</div></section>`;
}
function conectarAvisos(recargar) {
  main().addEventListener('click', async e => { const b = e.target.closest('[data-enterado-c]'); if (!b) return; b.disabled = true; try { await db().insertar('avisos_leidos', [{aviso_id: +b.dataset.enteradoC, persona_id: C.yo.id}]); recargar(); } catch (x) { alert('No se pudo marcar: ' + x.message); b.disabled = false; } });
}

// ---------- Alumno ----------
async function datosAlumno(alumnoId) {
  const ins = await db().leer('inscripciones', {alumno_id: alumnoId});
  const gids = ins.map(i => i.grupo_id);
  const [grupos, tareas, asis] = await Promise.all([db().leer('grupos', {id: gids}), db().leer('tareas', {grupo_id: gids}, {orden: 'entrega', desc: true}), db().leer('asistencia', {alumno_id: alumnoId, fecha: {desde: hace(28)}}, {orden: 'fecha', desc: true})]);
  const entregas = await db().leer('entregas', {alumno_id: alumnoId, tarea_id: tareas.map(t => t.id)});
  const profes = await db().leer('personas', {id: [...new Set(grupos.map(g => g.profesor_id).filter(Boolean))]});
  return {grupos, tareas, asis, entregas, profes: porId(profes)};
}
const estadoTarea = (t, e) => e ? (e.calificacion != null ? 'calificada' : 'entregada') : new Date(t.entrega) < new Date() ? 'sin entregar' : 'pendiente';
const chipTarea = (st, e) => st === 'calificada' ? `<span class="nota" style="color:${colorNota(+e.calificacion)}">${+e.calificacion}</span>` : st === 'entregada' ? '<span class="chip ok">Entregada</span>' : st === 'sin entregar' ? '<span class="chip mal">No la entregó</span>' : '<span class="chip">Por entregar</span>';
function resumenAsistencia(asis) { const n = asis.length, f = asis.filter(a => a.estado === 'F').length, r = asis.filter(a => a.estado === 'R').length; return {n, f, r, p: pct(n - f, n)}; }

async function vAlumnoInicio() {
  const yo = C.yo; marcoC('c/inicio', 'Inicio', cargando());
  const d = await datosAlumno(yo.id), ra = resumenAsistencia(d.asis), ent = Object.fromEntries(d.entregas.map(e => [e.tarea_id, e]));
  const pend = d.tareas.filter(t => estadoTarea(t, ent[t.id]) === 'pendiente'), cal = d.entregas.filter(e => e.calificacion != null).map(e => +e.calificacion);
  const nino = yo.nivel === 'primaria';
  main().innerHTML = `
   <section class="hero portada" id="portada"><span class="formas" aria-hidden="true"><i></i><i></i><i></i></span><p>${nino ? '¡Hola' : 'Hola'},</p><h2>${esc(yo.nombre.split(' ')[0])}${nino ? '!' : ''}</h2><p>${NIVELES[yo.nivel]} · ${esc(yo.grado || '')}</p></section>
   <div class="rejilla">
    <section class="tarjeta dato"><small>Asistencia (4 semanas)</small><b>${ra.p == null ? '—' : ra.p + ' %'}</b><span>${ra.f} falta${ra.f !== 1 ? 's' : ''} · ${ra.r} retardo${ra.r !== 1 ? 's' : ''}</span></section>
    <a class="tarjeta dato" href="#c/tareas" style="color:inherit"><small>${nino ? 'Tareas por hacer' : 'Tareas por entregar'}</small><b>${pend.length}</b><span>${pend[0] ? 'La próxima: ' + fCorta2(pend.at(-1).entrega) : 'Todo al día'}</span></a>
    ${nino ? '' : `<section class="tarjeta dato"><small>Promedio de tareas</small><b>${cal.length ? num(cal.reduce((a, b) => a + b, 0) / cal.length, 1) : '—'}</b><span>${cal.length} calificada${cal.length !== 1 ? 's' : ''}</span></section>`}
   </div>
   <section class="tarjeta"><h2>${nino ? 'Mi salón' : 'Mis clases'}</h2><div class="lista">${d.grupos.map(g => `<div class="it"><span class="chip" style="padding:6px">${ic('reloj', 'style="width:16px;height:16px"')}</span><div class="t"><b>${esc(g.materia.startsWith('Grupo') ? g.nombre : g.materia)}</b><span>${esc(d.profes[g.profesor_id]?.nombre || '')} · ${horarioTxt(g)} · ${esc(g.aula || '')}</span></div></div>`).join('') || '<div class="vacio">Sin clases asignadas.</div>'}</div></section>
   ${await htmlAvisos()}`;
  conectarAvisos(vAlumnoInicio);
}
async function vAlumnoTareas() {
  const yo = C.yo; marcoC('c/tareas', yo.nivel === 'primaria' ? 'Mis tareas' : 'Tareas', cargando());
  const d = await datosAlumno(yo.id), ent = Object.fromEntries(d.entregas.map(e => [e.tarea_id, e])), gs = porId(d.grupos), nino = yo.nivel === 'primaria';
  main().innerHTML = `<section class="tarjeta">${d.tareas.map(t => { const e = ent[t.id], st = estadoTarea(t, e), abierta = new Date(t.entrega) > new Date();
    return `<article class="tarea"><div class="fila" style="align-items:flex-start"><div><span class="meta">${esc(gs[t.grupo_id]?.materia.startsWith('Grupo') ? gs[t.grupo_id].nombre : gs[t.grupo_id]?.materia || '')} · ${esc(d.profes[gs[t.grupo_id]?.profesor_id]?.nombre || '')}</span><h3>${esc(t.titulo)}</h3></div>${chipTarea(st, e)}</div>
     ${t.descripcion ? `<p>${esc(t.descripcion)}</p>` : ''}${(t.requisitos || []).length ? `<ul>${t.requisitos.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
     <span class="meta">Entrega: ${fLarga(t.entrega)} a las ${new Date(t.entrega).toTimeString().slice(0, 5)}</span>
     ${e?.comentario ? `<div class="coment"><b>Comentario:</b> ${esc(e.comentario)}</div>` : ''}
     ${nino ? (abierta && !e ? '<span class="meta">Entrégala en tu salón; tu maestro la registra aquí.</span>' : '') : `<div class="acc">
      ${e?.archivo_ruta ? `<button class="btn sec" data-ver-entrega="${esc(e.archivo_ruta)}" data-n="${esc(e.archivo_nombre || 'archivo')}">${ic('ojo', 'style="width:16px;height:16px;vertical-align:-3px;margin-right:4px"')}Ver mi entrega</button>` : ''}
      ${abierta && (!e || e.calificacion == null) ? `<label class="btn" style="flex-direction:row;color:#fff;font-size:13px;cursor:pointer">${ic('subir', 'style="width:16px;height:16px"')} ${e ? 'Cambiar archivo' : 'Subir mi entrega'}<input type="file" data-t="${t.id}" hidden></label>` : ''}</div>`}
    </article>`; }).join('') || '<div class="vacio">No tienes tareas.</div>'}</section>`;
  main().onchange = async e => { const i = e.target.closest('input[data-t]'); if (!i?.files[0]) return; const f = i.files[0]; if (f.size > 25 * 1048576) return alert('El archivo pesa más de 25 MB.');
    try { const {ruta} = await ARCHIVOS.guardar('entregas', `${i.dataset.t}/${yo.id}`, f); await db().upsert('entregas', [{tarea_id: +i.dataset.t, alumno_id: yo.id, archivo_ruta: ruta, archivo_nombre: f.name, entregada_en: new Date().toISOString()}], 'tarea_id,alumno_id'); alert(`Listo: "${f.name}" quedó entregado.`); vAlumnoTareas(); }
    catch (x) { alert('No se pudo entregar: ' + x.message); } };
  main().onclick = async e => { const b = e.target.closest('[data-ver-entrega]'); if (!b) return; try { VISOR.abrir({nombre: b.dataset.n, url: await db().url('entregas', b.dataset.verEntrega)}); } catch (x) { alert('No se pudo abrir: ' + x.message); } };
}

// ---------- Mensajes (alumno, padre y profesor) ----------
let chatC = null;
async function contactosDe(yo, grupoProf) {
  if (yo.rol === 'profesor') {
    const ins = await db().leer('inscripciones', {grupo_id: grupoProf});
    const alumnos = await db().leer('personas', {id: ins.map(i => i.alumno_id)});
    const tut = await db().leer('tutores', {alumno_id: alumnos.map(a => a.id)});
    const padres = porId(await db().leer('personas', {id: tut.map(t => t.padre_id)}));
    const conCuenta = alumnos.filter(a => a.auth_id).map(a => ({id: a.id, nombre: a.nombre, sub: 'Alumno'}));
    const papas = tut.filter(t => padres[t.padre_id]).map(t => ({id: t.padre_id, nombre: padres[t.padre_id].nombre, sub: `${t.parentesco} de ${alumnos.find(a => a.id === t.alumno_id)?.nombre.split(' ')[0] || ''}`}));
    return [{id: 'grupo:' + grupoProf, nombre: 'Todo el grupo', sub: `Aviso para ${ins.length} alumnos y sus familias`}, ...papas, ...conCuenta];
  }
  let alumnoId = yo.id;
  if (yo.rol === 'padre') { const t = await db().leer('tutores', {padre_id: yo.id}); alumnoId = t[0]?.alumno_id; }
  const ins = await db().leer('inscripciones', {alumno_id: alumnoId}), grupos = await db().leer('grupos', {id: ins.map(i => i.grupo_id)});
  const profes = porId(await db().leer('personas', {id: grupos.map(g => g.profesor_id).filter(Boolean)}));
  const admins = await db().leer('personas', {rol: 'admin'});
  return [...grupos.filter(g => profes[g.profesor_id]).map(g => ({id: g.profesor_id, nombre: profes[g.profesor_id].nombre, sub: g.materia.startsWith('Grupo') ? 'Titular · ' + g.nombre : g.materia, grupo: g.id})), ...admins.map(a => ({id: a.id, nombre: 'Control escolar', sub: a.nombre}))];
}
async function hiloCon(yo, c) {
  if (c.id.startsWith('grupo:')) return db().leer('mensajes', {grupo_id: c.id.slice(6), para: null}, {orden: 'creado_en'});
  const [a, b] = await Promise.all([db().leer('mensajes', {de: yo.id, para: c.id}), db().leer('mensajes', {de: c.id, para: yo.id})]);
  const grupales = c.grupo ? (await db().leer('mensajes', {grupo_id: c.grupo, para: null})).filter(m => m.de === c.id) : [];
  return [...a, ...b, ...grupales].sort((x, y) => new Date(x.creado_en) - new Date(y.creado_en));
}
async function burbujaC(m, yo) {
  let adj = '';
  if (m.adjunto_ruta) {
    let url = ''; try { url = await db().url('adjuntos', m.adjunto_ruta); } catch {}
    const tipo = m.adjunto_tipo || '';
    adj = /^image\//.test(tipo) ? `<img class="adj-img" src="${url}" alt="${esc(m.adjunto_nombre)}" data-adj-url="${esc(url)}" data-n="${esc(m.adjunto_nombre)}">`
      : /^audio\//.test(tipo) ? `<div class="adj-audio">${/^Nota de voz/.test(m.adjunto_nombre) ? '<small style="margin:0 0 4px;font-weight:700">Nota de voz</small>' : ''}<audio controls preload="metadata" src="${url}"></audio></div>`
      : `<button type="button" class="adj-arch" data-adj-url="${esc(url)}" data-n="${esc(m.adjunto_nombre)}">${ic('docs')}<span><b>${esc(m.adjunto_nombre)}</b><small>ver sin descargar</small></span></button>`;
  }
  return `<div class="burbuja ${m.de === yo.id ? 'mia' : ''}">${m.grupo_id && !m.para ? '<small style="font-weight:700;margin:0 0 2px">Para todo el grupo</small>' : m.tarea_id ? '<small style="font-weight:700;margin:0 0 2px">Comentario en una tarea</small>' : ''}${adj}${m.texto ? esc(m.texto) : ''}<small>${hora(m.creado_en)}</small></div>`;
}
async function vMensajes(ruta, grupoProf, cont) {
  const yo = C.yo, propio = !!cont;
  if (!cont) { marcoC(ruta, 'Mensajes', cargando()); cont = main(); } else if (!cont.querySelector('.chat')) cont.innerHTML = cargando();
  const contactos = await contactosDe(yo, grupoProf);
  if (chatC && !contactos.some(c => c.id === chatC)) chatC = null;
  if (!chatC && innerWidth > 820 && contactos[0]) chatC = contactos[0].id;
  const c = contactos.find(x => x.id === chatC), hilo = c ? await hiloCon(yo, c) : [];
  const puedeEscribir = c && (!c.id.startsWith('grupo:') || yo.rol === 'profesor');
  cont.innerHTML = `<div class="chat ${c ? 'abierto' : ''}"><section class="tarjeta contactos"><h2>${yo.rol === 'profesor' ? 'Mensajes del grupo' : 'Escribir a'}</h2>
   <div class="lista">${contactos.map(x => `<div class="it ${x.id === chatC ? 'activo' : ''}" data-c="${esc(x.id)}"><span class="avatar" style="width:40px;height:40px;font-size:12px">${x.id.startsWith('grupo:') ? ic('perfil', 'style="width:18px;height:18px"') : iniciales(x.nombre)}</span><div class="t"><b>${esc(x.nombre)}</b><span>${esc(x.sub)}</span></div></div>`).join('') || '<div class="vacio">No hay con quién escribir todavía.</div>'}</div></section>
   <section class="tarjeta conversacion">${c ? `<div><button class="btn sec solo-movil" id="catras" style="padding:6px 10px;font-size:13px;margin-bottom:6px">← Contactos</button><h2>${esc(c.nombre)}</h2><span style="font-size:13px;color:var(--gris)">${esc(c.sub)}</span></div>
    <div class="burbujas" id="cbb">${hilo.length ? (await Promise.all(hilo.map(m => burbujaC(m, yo)))).join('') : '<div class="vacio">Todavía no hay mensajes.</div>'}</div>
    ${puedeEscribir ? barraEscribir('cfm', c.id.startsWith('grupo:') ? 'Aviso para todo el grupo…' : 'Escribe tu mensaje…') : ''}` : `<div class="vacio">${ic('msg')}Elige con quién hablar.</div>`}</section></div>`;
  const bb = cont.querySelector('#cbb'); if (bb) bb.scrollTop = bb.scrollHeight;
  const recargar = () => vMensajes(ruta, grupoProf, propio ? cont : null);
  cont.onclick = async e => {
    const it = e.target.closest('[data-c]'); if (it) { chatC = it.dataset.c; return recargar(); }
    if (e.target.id === 'catras') { chatC = null; return recargar(); }
    const a = e.target.closest('[data-adj-url]'); if (a) VISOR.abrir({nombre: a.dataset.n, url: a.dataset.adjUrl});
  };
  const fm = cont.querySelector('#cfm');
  if (fm) conectarEscribir(fm, async (texto, adj) => {
    const fila = {de: yo.id, texto: texto || null};
    if (c.id.startsWith('grupo:')) fila.grupo_id = c.id.slice(6); else fila.para = c.id;
    try {
      if (adj) { const {ruta, archivo} = await ARCHIVOS.guardar('adjuntos', yo.id, adj.blob instanceof File ? adj.blob : new File([adj.blob], adj.nombre, {type: adj.blob.type})); Object.assign(fila, {adjunto_ruta: ruta, adjunto_nombre: archivo.name === adj.nombre || !/\.webp$/.test(archivo.name) ? adj.nombre : adj.nombre.replace(/\.\w+$/, '') + '.webp', adjunto_tipo: archivo.type || ''}); }
      await db().insertar('mensajes', [fila]); recargar();
    } catch (x) { alert('No se pudo enviar: ' + x.message); }
  });
}

// ---------- Padre ----------
async function vPadre() {
  const yo = C.yo; marcoC('c/hijo', 'Resumen', cargando());
  const tut = await db().leer('tutores', {padre_id: yo.id});
  if (!tut.length) { main().innerHTML = '<div class="vacio">No hay alumnos ligados a tu cuenta. Pide a control escolar que te vincule.</div>'; return; }
  const hijo = (await db().leer('personas', {id: tut[0].alumno_id}))[0];
  const [d, notas] = await Promise.all([datosAlumno(hijo.id), db().leer('anotaciones', {alumno_id: hijo.id}, {orden: 'creado_en', desc: true})]);
  const ra = resumenAsistencia(d.asis), ent = Object.fromEntries(d.entregas.map(e => [e.tarea_id, e])), gs = porId(d.grupos);
  const hoy = iso(new Date()), deHoy = d.asis.filter(a => a.fecha === hoy);
  const fechas = [...new Set(d.asis.map(a => a.fecha))].slice(0, 10);
  const kinder = hijo.nivel === 'kinder';
  main().innerHTML = `
   <section class="hero portada" id="portada" style="background:linear-gradient(135deg,#0E6E8C,#0A4D63)"><span class="formas" aria-hidden="true"><i></i><i></i><i></i></span><p>${esc(tut[0].parentesco)} de</p><h2>${esc(hijo.nombre)}</h2><p>${NIVELES[hijo.nivel]} · ${esc(hijo.grado || '')}</p></section>
   <div class="rejilla">
    <section class="tarjeta dato"><small>Hoy</small><b style="font-size:22px;color:${deHoy.some(a => a.estado === 'F') ? 'var(--mal)' : deHoy.length ? 'var(--ok)' : 'inherit'}">${deHoy.length ? (deHoy.some(a => a.estado === 'F') ? 'No asistió' : deHoy.some(a => a.estado === 'R') ? 'Llegó con retardo' : 'Asistió') : 'Sin registro aún'}</b><span>${deHoy.length ? 'Según el pase de lista' : 'El maestro todavía no pasa lista'}</span></section>
    <section class="tarjeta dato"><small>Asistencia (4 semanas)</small><b>${ra.p == null ? '—' : ra.p + ' %'}</b><span>${ra.f} falta${ra.f !== 1 ? 's' : ''} · ${ra.r} retardo${ra.r !== 1 ? 's' : ''}</span></section>
    <section class="tarjeta dato"><small>${kinder ? 'Actividades' : 'Tareas'}</small><b>${d.tareas.filter(t => estadoTarea(t, ent[t.id]) === 'pendiente').length} por entregar</b><span>${d.tareas.filter(t => estadoTarea(t, ent[t.id]) === 'sin entregar').length} sin entregar</span></section>
   </div>
   <section class="tarjeta"><div class="fila"><h2>Lo que dicen sus maestros</h2><span class="chip">${notas.length}</span></div>
    <div class="lista">${notas.map(n => `<div class="it" style="align-items:flex-start"><span class="chip ${TIPOS_NOTA[n.tipo][1]}" style="white-space:nowrap">${TIPOS_NOTA[n.tipo][0]}</span><div class="t"><b style="font-weight:500">${esc(n.texto)}</b><span>${esc(d.profes[n.autor_id]?.nombre || 'Maestro')} · ${hora(n.creado_en)}</span></div></div>`).join('') || '<div class="vacio">Sin anotaciones por ahora.</div>'}</div></section>
   <section class="tarjeta"><div class="fila"><h2>Asistencia por día</h2></div><span style="font-size:12px;color:var(--gris)">Toca un día para ver el detalle de cada clase.</span>
    <div class="semana-asis" style="grid-template-columns:repeat(auto-fill,minmax(86px,1fr))">${fechas.map(f => { const del = d.asis.filter(a => a.fecha === f), est = del.some(a => a.estado === 'F') ? 'mal' : del.some(a => a.estado === 'R') ? 'aviso' : 'ok'; return `<button type="button" class="${est}" data-dia-c="${f}" title="${fLarga(f)}: ${del.length} clase${del.length !== 1 ? 's' : ''}"><b>${fLarga(f).split(' ')[0].slice(0, 3)}</b><span>${fCorta2(f)}</span><small>${est === 'ok' ? 'Asistió' : est === 'aviso' ? 'Retardo' : 'Falta'}</small></button>`; }).join('') || '<div class="vacio">Sin registros.</div>'}</div><div id="ddc"></div></section>
   <section class="tarjeta"><div class="fila"><h2>${kinder ? 'Actividades' : 'Tareas'}</h2></div><div class="lista">${d.tareas.map(t => { const e = ent[t.id], st = estadoTarea(t, e); return `<div class="it"><div class="t"><b>${esc(t.titulo)}</b><span>${esc(gs[t.grupo_id]?.materia.startsWith('Grupo') ? gs[t.grupo_id].nombre : gs[t.grupo_id]?.materia || '')} · ${fCorta2(t.entrega)}</span></div>${kinder && st === 'entregada' ? '<span class="chip ok">Hecha</span>' : chipTarea(st, e)}</div>`; }).join('')}</div></section>
   ${await htmlAvisos()}`;
  conectarAvisos(vPadre);
  main().addEventListener('click', e => { const b = e.target.closest('[data-dia-c]'); if (!b) return; const f = b.dataset.diaC, del = d.asis.filter(a => a.fecha === f);
    document.querySelectorAll('[data-dia-c]').forEach(x => x.classList.toggle('sel', x === b));
    document.getElementById('ddc').innerHTML = `<h2 style="font-size:15px;margin-top:8px">${fLarga(f)}</h2><div class="lista">${del.map(a => `<div class="it"><div class="t"><b>${esc(gs[a.grupo_id]?.materia.startsWith('Grupo') ? gs[a.grupo_id].nombre : gs[a.grupo_id]?.materia || '')}</b><span>${horarioTxt(gs[a.grupo_id] || {})}${a.nota ? ' · ' + esc(a.nota) : ''}${a.perdonado ? ' · retardo perdonado' : ''}</span></div><span class="chip ${a.estado === 'P' ? 'ok' : a.estado === 'R' ? 'aviso' : 'mal'}">${a.estado === 'P' ? 'Entró' : a.estado === 'R' ? 'Retardo' : 'Falta'}</span></div>`).join('')}</div>`; });
}

// ---------- Profesor ----------
async function vProfGrupos() {
  marcoC('c/grupos', 'Mis grupos', cargando());
  const gs = C.cache.misGrupos, ins = await db().leer('inscripciones', {grupo_id: gs.map(g => g.id)}), tareas = await db().leer('tareas', {grupo_id: gs.map(g => g.id)});
  const ents = await db().leer('entregas', {tarea_id: tareas.map(t => t.id)});
  main().innerHTML = `<div class="rejilla">${gs.map(g => { const n = ins.filter(i => i.grupo_id === g.id).length, pc = ents.filter(e => e.calificacion == null && e.archivo_nombre && tareas.find(t => t.id === e.tarea_id)?.grupo_id === g.id).length;
    return `<a class="tarjeta" href="#c/g/${g.id}/lista" style="color:inherit"><div class="fila"><h2>${esc(g.nombre)}</h2><span class="chip">${NIVELES[g.nivel]}</span></div><span style="font-size:14px">${esc(g.materia)}</span><span style="font-size:12px;color:var(--gris)">${horarioTxt(g)} · ${esc(g.aula || '')} · ${n} alumnos</span>${g.nivel !== 'kinder' && pc ? `<span class="chip aviso" style="align-self:flex-start">${pc} por calificar</span>` : ''}</a>`; }).join('')}</div>`;
}
async function vGrupo(gid, tab) {
  const g = C.cache.misGrupos.find(x => x.id === gid), kinder = g.nivel === 'kinder';
  const tabs = [['lista', 'Lista'], ['tareas', kinder ? 'Actividades' : 'Tareas'], ['anotaciones', 'Anotaciones'], ['mensajes', 'Mensajes']];
  marcoC(`c/g/${gid}/${tab}`, g.nombre, `<section class="tarjeta"><div class="fila"><div><h2>${esc(g.nombre)} · ${esc(g.materia)}</h2><span style="font-size:13px;color:var(--gris)">${NIVELES[g.nivel]} · ${horarioTxt(g)} · ${esc(g.aula || '')}</span></div><a class="btn sec" href="#c/grupos" style="padding:8px 12px;font-size:13px">← Grupos</a></div></section>
   <div class="tabs">${tabs.map(([k, t]) => `<a class="tab ${k === tab ? 'activo' : ''}" href="#c/g/${gid}/${k}">${t}</a>`).join('')}</div><div id="gpc">${cargando()}</div>`);
  const cont = document.getElementById('gpc');
  const ins = await db().leer('inscripciones', {grupo_id: gid}), alumnos = (await db().leer('personas', {id: ins.map(i => i.alumno_id)})).sort((a, b) => a.nombre.localeCompare(b.nombre));
  if (tab === 'lista') return gLista(g, alumnos, cont, ultimaClaseDe(g));
  if (tab === 'tareas') return gTareas(g, alumnos, cont);
  if (tab === 'anotaciones') return gNotas(g, alumnos, cont);
  if (tab === 'mensajes') return vMensajes(`c/g/${gid}/mensajes`, gid, cont);
}
async function gLista(g, alumnos, cont, fecha) {
  const [del, previas] = await Promise.all([db().leer('asistencia', {grupo_id: g.id, fecha}), db().leer('asistencia', {grupo_id: g.id, fecha: {desde: hace(28)}})]);
  const reg = Object.fromEntries(del.map(a => [a.alumno_id, {...a}]));
  const porc = id => { const r = previas.filter(a => a.alumno_id === id); return pct(r.filter(a => a.estado !== 'F').length, r.length); };
  const pinta = () => {
    const n = k => alumnos.filter(a => reg[a.id]?.estado === k).length, sin = alumnos.filter(a => !reg[a.id]).length;
    cont.innerHTML = `<section class="tarjeta"><div class="fila" style="flex-wrap:wrap"><h2>Pase de lista</h2><label style="flex-direction:row;align-items:center;gap:8px">Fecha<input type="date" id="lfc" value="${fecha}" max="${iso(new Date())}" style="width:auto;padding:8px 10px"></label></div>
     ${hayClase(g, deIso(fecha)) ? '' : `<span class="chip aviso" style="align-self:flex-start">Este grupo no tiene clase el ${DIAS_C[deIso(fecha).getDay()].toLowerCase()}</span>`}
     <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="chip ok">${n('P')} presentes</span><span class="chip aviso">${n('R')} retardos</span><span class="chip mal">${n('F')} faltas</span>${sin ? `<span class="chip">${sin} sin marcar</span>` : ''}<span style="flex:1"></span><button class="btn sec" id="ltc" style="padding:8px 12px;font-size:13px">Todos presentes</button></div>
     <div class="lista">${alumnos.map(a => { const r = reg[a.id]; return `<div class="it"><span class="avatar" style="width:36px;height:36px;font-size:12px;color:#fff;background:#8C7FA0">${iniciales(a.nombre)}</span><div class="t"><b>${esc(a.nombre)}</b><span>Asistencia ${porc(a.id) ?? '—'}${porc(a.id) != null ? ' %' : ''}${r?.perdonado ? ' · retardo perdonado' : ''}${r?.estado === 'R' ? ` · <a href="#" data-perdona="${a.id}" style="font-weight:600">Perdonar retardo</a>` : ''}</span></div>
      <div class="seg" data-m="${a.id}">${['P', 'R', 'F'].map(k => `<button data-k="${k}" class="${k} ${r?.estado === k ? 'on' : ''}" title="${{P: 'Presente', R: 'Retardo', F: 'Falta'}[k]}">${k}</button>`).join('')}</div></div>`; }).join('')}</div>
     <button class="btn" id="lgc">Guardar lista</button><span id="lmsg" style="font-size:13px;text-align:center;color:var(--gris)">Los papás y el alumno lo ven en cuanto guardas.</span></section>`;
  };
  pinta();
  cont.onchange = e => { if (e.target.id === 'lfc' && e.target.value) gLista(g, alumnos, cont, e.target.value); };
  cont.onclick = async e => {
    const b = e.target.closest('.seg button'); if (b) { const m = b.parentNode.dataset.m; reg[m] = {...(reg[m] || {}), estado: b.dataset.k, perdonado: false}; return pinta(); }
    const pr = e.target.closest('[data-perdona]'); if (pr) { e.preventDefault(); reg[pr.dataset.perdona] = {...reg[pr.dataset.perdona], estado: 'P', perdonado: true}; return pinta(); }
    if (e.target.id === 'ltc') { alumnos.forEach(a => { if (!reg[a.id]) reg[a.id] = {estado: 'P', perdonado: false}; }); return pinta(); }
    if (e.target.id === 'lgc') { const filas = alumnos.filter(a => reg[a.id]).map(a => ({grupo_id: g.id, fecha, alumno_id: a.id, estado: reg[a.id].estado, perdonado: !!reg[a.id].perdonado, nota: reg[a.id].nota || null, registrado_por: C.yo.id, actualizado_en: new Date().toISOString()}));
      if (filas.length < alumnos.length && !confirm(`Faltan ${alumnos.length - filas.length} alumnos por marcar. ¿Guardar así?`)) return;
      e.target.disabled = true; try { await db().upsert('asistencia', filas, 'grupo_id,fecha,alumno_id'); document.getElementById('lmsg').textContent = `Lista del ${fLarga(fecha)} guardada.`; document.getElementById('lmsg').style.color = 'var(--ok)'; } catch (x) { alert('No se pudo guardar: ' + x.message); } e.target.disabled = false; }
  };
}
async function gTareas(g, alumnos, cont, abierta) {
  const tareas = await db().leer('tareas', {grupo_id: g.id}, {orden: 'entrega', desc: true}), ents = await db().leer('entregas', {tarea_id: tareas.map(t => t.id)}), kinder = g.nivel === 'kinder', registra = ['kinder', 'primaria'].includes(g.nivel);
  if (abierta) {
    const t = tareas.find(x => x.id === abierta), E = Object.fromEntries(ents.filter(e => e.tarea_id === t.id).map(e => [e.alumno_id, e]));
    cont.innerHTML = `<section class="tarjeta"><div class="fila" style="align-items:flex-start"><div><span style="font-size:12px;color:var(--gris)">Entrega ${fLarga(t.entrega)}</span><h2>${esc(t.titulo)}</h2></div><button class="btn sec" id="tvc" style="padding:8px 12px;font-size:13px">← ${kinder ? 'Actividades' : 'Tareas'}</button></div>
     <span class="chip" style="align-self:flex-start">${Object.keys(E).length} de ${alumnos.length} ${kinder ? 'la hicieron' : 'entregaron'}</span>
     <div class="lista">${alumnos.map(a => { const e = E[a.id]; return `<div class="it" style="flex-wrap:wrap"><div class="t" style="min-width:160px"><b>${esc(a.nombre)}</b><span>${e ? (e.archivo_nombre ? esc(e.archivo_nombre) + ' · ' : '') + hora(e.entregada_en) : 'Sin entregar'}</span></div>
      ${e?.archivo_ruta ? `<button class="btn sec" data-ver="${esc(e.archivo_ruta)}" data-n="${esc(e.archivo_nombre)}" style="padding:8px 12px;font-size:13px">${ic('ojo', 'style="width:16px;height:16px;vertical-align:-3px"')} Ver</button>` : ''}
      ${registra ? `<button class="btn ${e ? '' : 'sec'}" data-hecha="${a.id}" style="padding:8px 12px;font-size:13px">${e ? (kinder ? '✓ Hecha' : '✓ Entregada') : (kinder ? 'Marcar hecha' : 'Marcar entregada')}</button>` : ''}
      ${kinder ? '' : `<input type="number" min="0" max="100" class="cap" data-cal="${a.id}" value="${e?.calificacion ?? ''}" placeholder="—" aria-label="Calificación de ${esc(a.nombre)}" ${e ? '' : 'disabled title="Aún no entrega"'}>`}</div>`; }).join('')}</div>
     <span style="font-size:12px;color:var(--gris)">${registra ? (kinder ? 'Marca a quién ya la hizo; los papás lo ven al momento.' : 'Marca quién la entregó en el salón y escribe su calificación (Enter guarda).') : 'Escribe la calificación y pulsa Enter; se guarda sola.'}</span></section>`;
    cont.onclick = async e => { if (e.target.id === 'tvc') return gTareas(g, alumnos, cont);
      const v = e.target.closest('[data-ver]'); if (v) { try { VISOR.abrir({nombre: v.dataset.n, url: await db().url('entregas', v.dataset.ver)}); } catch (x) { alert(x.message); } }
      const h = e.target.closest('[data-hecha]'); if (h) { h.disabled = true; try { if (E[h.dataset.hecha]) await db().borrar('entregas', {tarea_id: t.id, alumno_id: h.dataset.hecha}); else await db().insertar('entregas', [{tarea_id: t.id, alumno_id: h.dataset.hecha, archivo_nombre: null}]); } catch (x) { alert('No se pudo guardar: ' + x.message); } gTareas(g, alumnos, cont, t.id); } };
    cont.onchange = async e => { const c = e.target.closest('[data-cal]'); if (!c) return; const v = c.value === '' ? null : Math.max(0, Math.min(100, +c.value));
      try { await db().actualizar('entregas', {calificacion: v, calificada_en: v == null ? null : new Date().toISOString()}, {tarea_id: t.id, alumno_id: c.dataset.cal}); c.style.borderColor = 'var(--ok)'; } catch (x) { alert('No se pudo guardar: ' + x.message); } };
    cont.onkeydown = e => { const c = e.target.closest('[data-cal]'); if (c && e.key === 'Enter') { c.blur(); const l = [...cont.querySelectorAll('[data-cal]:not([disabled])')]; l[l.indexOf(c) + 1]?.focus(); } };
    return;
  }
  cont.innerHTML = `<section class="tarjeta"><div class="fila"><h2>${kinder ? 'Actividades' : 'Tareas'} del grupo</h2><button class="btn" id="tnc" style="padding:9px 14px;font-size:13px">+ Nueva</button></div>
   <form id="tfc" class="oculto" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--linea);padding-top:12px"><label>Título<input id="ntc" required placeholder="${kinder ? 'Ej. Traer hojas de colores' : 'Ej. Ensayo: etapas del proceso penal'}"></label><label>Descripción<textarea id="ndc"></textarea></label><label>Requisitos (uno por renglón)<textarea id="nrc"></textarea></label><div class="form"><label>Fecha de entrega<input type="date" id="nfc" required min="${iso(new Date())}"></label><label>Hora<input type="time" id="nhc" value="23:59"></label></div><button class="btn" type="submit">Publicar a ${alumnos.length} alumnos</button></form>
   <div class="lista">${tareas.map(t => { const n = ents.filter(e => e.tarea_id === t.id).length, pc = ents.filter(e => e.tarea_id === t.id && e.calificacion == null && e.archivo_nombre).length; return `<a class="it" href="#" data-t="${t.id}" style="color:inherit"><div class="t"><b>${esc(t.titulo)}</b><span>Entrega ${fLarga(t.entrega)}</span></div><span class="chip">${n}/${alumnos.length}</span>${!kinder && pc ? `<span class="chip aviso">${pc} por calificar</span>` : ''}</a>`; }).join('') || '<div class="vacio">Sin tareas todavía.</div>'}</div></section>`;
  cont.onclick = e => { if (e.target.id === 'tnc') { cont.querySelector('#tfc').classList.toggle('oculto'); return; } const a = e.target.closest('[data-t]'); if (a) { e.preventDefault(); gTareas(g, alumnos, cont, +a.dataset.t); } };
  cont.querySelector('#tfc').onsubmit = async e => { e.preventDefault(); const f = e.target;
    try { await db().insertar('tareas', [{grupo_id: g.id, titulo: f.querySelector('#ntc').value.trim(), descripcion: f.querySelector('#ndc').value.trim() || null, requisitos: f.querySelector('#nrc').value.split('\n').map(x => x.trim()).filter(Boolean), entrega: new Date(`${f.querySelector('#nfc').value}T${f.querySelector('#nhc').value || '23:59'}`).toISOString(), creada_por: C.yo.id}]); gTareas(g, alumnos, cont); }
    catch (x) { alert('No se pudo publicar: ' + x.message); } };
}
async function gNotas(g, alumnos, cont, sel) {
  const notas = await db().leer('anotaciones', {alumno_id: alumnos.map(a => a.id)}, {orden: 'creado_en', desc: true});
  sel = sel || alumnos[0]?.id; const a = alumnos.find(x => x.id === sel), suyas = notas.filter(n => n.alumno_id === sel);
  cont.innerHTML = `${g.nivel === 'universidad' ? '<span style="font-size:13px;color:var(--gris)">En universidad casi no se usan, pero están disponibles (por ejemplo, para notas internas).</span>' : ''}
   <div class="notas-g"><section class="tarjeta contactos solo-escritorio"><h2>Alumnos</h2><div class="lista">${alumnos.map(x => { const n = notas.filter(y => y.alumno_id === x.id).length; return `<div class="it ${x.id === sel ? 'activo' : ''}" data-al="${x.id}"><span class="avatar" style="width:36px;height:36px;font-size:12px;color:#fff;background:#8C7FA0">${iniciales(x.nombre)}</span><div class="t"><b>${esc(x.nombre)}</b><span>${n} anotaci${n === 1 ? 'ón' : 'ones'}</span></div></div>`; }).join('')}</div></section>
   <section class="tarjeta"><label class="solo-movil">Alumno<select id="nsel">${alumnos.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.nombre)} (${notas.filter(y => y.alumno_id === x.id).length})</option>`).join('')}</select></label><h2>${esc(a?.nombre || '')}</h2>
    <form id="nfc2" style="display:flex;flex-direction:column;gap:8px"><div class="rapidas" id="ntipo">${Object.entries(TIPOS_NOTA).map(([k, [t]], i) => `<button type="button" data-tipo="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div>
     <textarea id="ntx" required placeholder="Ej. Es muy bueno explicando a sus compañeros; reforzar la lectura en voz alta."></textarea>
     <label style="flex-direction:row;align-items:center;gap:8px;color:var(--tinta)"><input type="checkbox" id="nvis" checked style="width:auto"> Que la vean sus papás</label>
     <button class="btn" type="submit">Guardar anotación</button></form>
    <div class="lista">${suyas.map(n => `<div class="it" style="align-items:flex-start"><span class="chip ${TIPOS_NOTA[n.tipo][1]}" style="white-space:nowrap">${TIPOS_NOTA[n.tipo][0]}</span><div class="t"><b style="font-weight:500">${esc(n.texto)}</b><span>${hora(n.creado_en)} · ${n.visible_padres ? 'La ven sus papás' : 'Solo para maestros'}</span></div>${n.autor_id === C.yo.id ? `<button class="btn sec" data-borra="${n.id}" style="padding:6px 10px;font-size:12px">Borrar</button>` : ''}</div>`).join('') || '<div class="vacio">Sin anotaciones de este alumno.</div>'}</div></section></div>`;
  let tipo = 'fortaleza';
  cont.querySelector('#nsel').onchange = e => gNotas(g, alumnos, cont, e.target.value);
  cont.onclick = async e => { const al = e.target.closest('[data-al]'); if (al) return gNotas(g, alumnos, cont, al.dataset.al);
    const t = e.target.closest('[data-tipo]'); if (t) { tipo = t.dataset.tipo; cont.querySelectorAll('#ntipo button').forEach(x => x.classList.toggle('on', x === t)); }
    const b = e.target.closest('[data-borra]'); if (b && confirm('¿Borrar esta anotación?')) { try { await db().borrar('anotaciones', {id: +b.dataset.borra}); gNotas(g, alumnos, cont, sel); } catch (x) { alert(x.message); } } };
  cont.querySelector('#nfc2').onsubmit = async e => { e.preventDefault();
    try { await db().insertar('anotaciones', [{alumno_id: sel, autor_id: C.yo.id, grupo_id: g.id, tipo, texto: cont.querySelector('#ntx').value.trim(), visible_padres: cont.querySelector('#nvis').checked}]); gNotas(g, alumnos, cont, sel); }
    catch (x) { alert('No se pudo guardar: ' + x.message); } };
}

// ---------- Administración ----------
async function datosAdmin() {
  const [personas, grupos, ins, asis, tareas, ents, avisos, leidos] = await Promise.all([db().leer('personas', {}, {orden: 'nombre'}), db().leer('grupos', {}, {orden: 'id'}), db().leer('inscripciones'), db().leer('asistencia', {fecha: {desde: hace(28)}}), db().leer('tareas'), db().leer('entregas'), db().leer('avisos', {}, {orden: 'creado_en', desc: true}), db().leer('avisos_leidos')]);
  return {personas, grupos, ins, asis, tareas, ents, avisos, leidos, P: porId(personas)};
}
async function vAdmin() {
  marcoC('c/admin', 'Resumen', cargando());
  const d = await datosAdmin(), alumnos = d.personas.filter(p => p.rol === 'alumno'), hoy = iso(new Date());
  const porNivel = Object.keys(NIVELES).map(n => [n, alumnos.filter(a => a.nivel === n).length, d.grupos.filter(g => g.nivel === n).length]);
  const sinLista = d.grupos.filter(g => hayClase(g, new Date()) && !d.asis.some(a => a.grupo_id === g.id && a.fecha === hoy));
  const faltas = {}; d.asis.filter(a => a.estado === 'F').forEach(a => faltas[a.alumno_id] = (faltas[a.alumno_id] || 0) + 1);
  const riesgo = Object.entries(faltas).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const asisG = g => { const r = d.asis.filter(a => a.grupo_id === g.id); return pct(r.filter(a => a.estado !== 'F').length, r.length); };
  const pc = g => d.ents.filter(e => e.calificacion == null && e.archivo_nombre && d.tareas.find(t => t.id === e.tarea_id)?.grupo_id === g.id && g.nivel !== 'kinder').length;
  main().innerHTML = `
   <div class="rejilla">
    <section class="tarjeta dato"><small>Alumnos</small><b>${alumnos.length}</b><span>${alumnos.filter(a => a.auth_id).length} con cuenta</span></section>
    <section class="tarjeta dato"><small>Profesores</small><b>${d.personas.filter(p => p.rol === 'profesor').length}</b><span>${d.grupos.length} grupos</span></section>
    <section class="tarjeta dato"><small>Asistencia general (4 semanas)</small><b>${pct(d.asis.filter(a => a.estado !== 'F').length, d.asis.length) ?? '—'} %</b><span>${d.asis.filter(a => a.estado === 'F').length} faltas registradas</span></section>
    <section class="tarjeta dato"><small>Hoy sin pase de lista</small><b style="color:${sinLista.length ? 'var(--aviso)' : 'var(--ok)'}">${sinLista.length}</b><span>${sinLista.length ? sinLista.map(g => g.nombre).join(', ') : 'Todo al día'}</span></section>
   </div>
   <section class="tarjeta"><h2>Por nivel</h2><table><thead><tr><th>Nivel</th><th class="num">Alumnos</th><th class="num">Grupos</th></tr></thead><tbody>${porNivel.map(([n, a, g]) => `<tr><td>${NIVELES[n]}</td><td class="num">${a}</td><td class="num">${g}</td></tr>`).join('')}</tbody></table></section>
   <div class="rejilla">
    <section class="tarjeta"><h2>Grupos</h2><div class="lista">${d.grupos.map(g => `<div class="it"><div class="t"><b>${esc(g.nombre)} · ${esc(g.materia)}</b><span>${esc(d.P[g.profesor_id]?.nombre || 'Sin profesor')} · ${d.ins.filter(i => i.grupo_id === g.id).length} alumnos</span></div><span class="chip ${asisG(g) >= 90 ? 'ok' : 'aviso'}">${asisG(g) ?? '—'} %</span>${pc(g) ? `<span class="chip aviso">${pc(g)} por calificar</span>` : ''}</div>`).join('')}</div></section>
    <section class="tarjeta"><h2>Alumnos con más faltas</h2><div class="lista">${riesgo.map(([id, n]) => `<div class="it"><div class="t"><b>${esc(d.P[id]?.nombre || '')}</b><span>${NIVELES[d.P[id]?.nivel] || ''} · ${esc(d.P[id]?.grado || '')}</span></div><span class="chip mal">${n} faltas</span></div>`).join('') || '<div class="vacio">Nadie con 2 faltas o más.</div>'}</div></section>
   </div>
   <section class="tarjeta"><div class="fila"><h2>Avisos recientes</h2><a href="#c/admin/avisos" style="font-size:13px;font-weight:600">Publicar</a></div><div class="lista">${d.avisos.slice(0, 4).map(a => `<div class="it"><div class="t"><b>${esc(a.titulo)}</b><span>${a.nivel ? NIVELES[a.nivel] : 'Para todos'} · ${hora(a.creado_en)}</span></div><span class="chip">${d.leidos.filter(l => l.aviso_id === a.id).length} enterados</span></div>`).join('')}</div></section>`;
}
let filtroAdmin = {nivel: '', q: ''};
async function vAdminAlumnos() {
  marcoC('c/admin/alumnos', 'Alumnos', cargando());
  const d = await datosAdmin(), alumnos = d.personas.filter(p => p.rol === 'alumno');
  const pinta = () => {
    const q = filtroAdmin.q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const ver = alumnos.filter(a => (!filtroAdmin.nivel || a.nivel === filtroAdmin.nivel) && (!q || (a.nombre + ' ' + (a.usuario || '')).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)));
    const asis = id => { const r = d.asis.filter(a => a.alumno_id === id); return pct(r.filter(a => a.estado !== 'F').length, r.length); };
    main().innerHTML = `
     <section class="tarjeta"><div class="fila" style="flex-wrap:wrap"><input id="aq" placeholder="Buscar por nombre o matrícula" value="${esc(filtroAdmin.q)}" style="flex:1;min-width:200px"><button class="btn" id="aalta" style="padding:10px 14px;font-size:13px">+ Dar de alta</button></div>
      <div class="tabs" id="anv">${[['', 'Todos'], ...Object.entries(NIVELES)].map(([k, t]) => `<button data-n="${k}" class="suave ${filtroAdmin.nivel === k ? 'activo' : ''}">${t} (${k ? alumnos.filter(a => a.nivel === k).length : alumnos.length})</button>`).join('')}</div>
      <form id="afalta" class="oculto" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--linea);padding-top:12px"><div class="form"><label>Nombre completo<input id="an" required></label><label>Nivel<select id="anl">${Object.entries(NIVELES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label><label>Grado<input id="ag" placeholder="Ej. 2.º de secundaria"></label><label>Grupo<select id="agr"></select></label><label>Matrícula<input id="am" placeholder="Opcional"></label></div><button class="btn" type="submit">Guardar alumno</button><span style="font-size:12px;color:var(--gris)">La cuenta para entrar (correo y contraseña) se crea aparte; aquí solo se da de alta el expediente.</span></form>
      <div style="overflow-x:auto"><table><thead><tr><th>Alumno</th><th>Nivel</th><th class="ocultar-movil">Grupo</th><th class="num">Asistencia</th><th class="num ocultar-movil">Cuenta</th></tr></thead><tbody>${ver.map(a => `<tr><td>${esc(a.nombre)}${a.estado && a.estado !== 'activo' ? ` <span class="chip ${a.estado === 'baja' ? 'mal' : 'aviso'}">${a.estado === 'baja' ? 'Baja' : 'Transferido'}</span>` : ''}<br><span style="font-size:12px;color:var(--gris)">${esc(a.usuario || '')} · ${esc(a.grado || '')}</span></td><td>${NIVELES[a.nivel] || ''}</td><td class="ocultar-movil">${d.ins.filter(i => i.alumno_id === a.id).map(i => esc(d.grupos.find(g => g.id === i.grupo_id)?.nombre || i.grupo_id)).join(', ')}</td><td class="num">${asis(a.id) ?? '—'}${asis(a.id) != null ? ' %' : ''}</td><td class="num ocultar-movil">${a.auth_id ? '<span class="chip ok">Sí</span>' : '<span class="chip">No</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Nadie coincide.</td></tr>'}</tbody></table></div></section>`;
    const sel = () => { const n = main().querySelector('#anl').value; main().querySelector('#agr').innerHTML = '<option value="">Sin grupo</option>' + d.grupos.filter(g => g.nivel === n).map(g => `<option value="${g.id}">${esc(g.nombre)} · ${esc(g.materia)}</option>`).join(''); };
    sel(); main().querySelector('#anl').onchange = sel;
    const q2 = main().querySelector('#aq'); q2.oninput = () => { filtroAdmin.q = q2.value; const p = q2.selectionStart; pinta(); const q3 = main().querySelector('#aq'); q3.focus(); q3.setSelectionRange(p, p); };
    main().onclick = e => { const b = e.target.closest('#anv button'); if (b) { filtroAdmin.nivel = b.dataset.n; pinta(); } if (e.target.id === 'aalta') main().querySelector('#afalta').classList.toggle('oculto'); };
    main().querySelector('#afalta').onsubmit = async e => { e.preventDefault(); const f = e.target;
      try { const [p] = await db().insertar('personas', [{rol: 'alumno', nombre: f.querySelector('#an').value.trim(), nivel: f.querySelector('#anl').value, grado: f.querySelector('#ag').value.trim() || null, usuario: f.querySelector('#am').value.trim() || null}]);
        if (f.querySelector('#agr').value) await db().insertar('inscripciones', [{grupo_id: f.querySelector('#agr').value, alumno_id: p.id}]);
        alert(`${p.nombre} quedó dado de alta.`); vAdminAlumnos(); } catch (x) { alert('No se pudo guardar: ' + x.message); } };
  };
  pinta();
}
async function vAdminProfesores() {
  marcoC('c/admin/profesores', 'Profesores', cargando());
  const d = await datosAdmin(), profes = d.personas.filter(p => p.rol === 'profesor');
  main().innerHTML = `<section class="tarjeta"><div style="overflow-x:auto"><table><thead><tr><th>Profesor</th><th>Grupos</th><th class="num">Última lista</th><th class="num">Por calificar</th><th class="num ocultar-movil">Anotaciones</th></tr></thead><tbody>${profes.map(p => { const gs = d.grupos.filter(g => g.profesor_id === p.id), ul = d.asis.filter(a => gs.some(g => g.id === a.grupo_id)).map(a => a.fecha).sort().at(-1), pc = d.ents.filter(e => e.calificacion == null && e.archivo_nombre && gs.some(g => g.id === d.tareas.find(t => t.id === e.tarea_id)?.grupo_id && g.nivel !== 'kinder')).length;
    return `<tr><td>${esc(p.nombre)}<br><span style="font-size:12px;color:var(--gris)">${NIVELES[p.nivel] || ''} · ${esc(p.grado || '')}</span></td><td>${gs.map(g => esc(g.nombre)).join(', ')}</td><td class="num">${ul ? fCorta2(ul) : '—'}</td><td class="num">${pc ? `<span class="chip aviso">${pc}</span>` : '0'}</td><td class="num ocultar-movil" data-notas="${p.id}">…</td></tr>`; }).join('')}</tbody></table></div></section>`;
  const notas = await db().leer('anotaciones'); main().querySelectorAll('[data-notas]').forEach(td => td.textContent = notas.filter(n => n.autor_id === td.dataset.notas).length);
}
async function vAdminAvisos() {
  marcoC('c/admin/avisos', 'Avisos', cargando());
  const d = await datosAdmin();
  const destinatarios = a => d.personas.filter(p => p.rol !== 'admin' && p.auth_id && (!a.nivel || p.nivel === a.nivel || (p.rol === 'padre' && d.personas.some(h => h.nivel === a.nivel)))).length;
  main().innerHTML = `<section class="tarjeta"><h2>Publicar aviso</h2><form id="avf" style="display:flex;flex-direction:column;gap:10px"><label>Título<input id="avt" required placeholder="Ej. Suspensión de clases"></label><label>Mensaje<textarea id="avx" required></textarea></label><label>Para<select id="avn"><option value="">Toda la escuela</option>${Object.entries(NIVELES).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label><button class="btn" type="submit">Publicar</button></form></section>
   <section class="tarjeta"><h2>Publicados</h2><div class="lista">${d.avisos.map(a => { const l = d.leidos.filter(x => x.aviso_id === a.id); return `<div class="it" style="align-items:flex-start"><div class="t"><b>${esc(a.titulo)}</b><span style="display:block;color:var(--tinta);font-size:14px">${esc(a.texto)}</span><span>${a.nivel ? NIVELES[a.nivel] : 'Toda la escuela'} · ${hora(a.creado_en)}${l.length ? ' · Enterados: ' + l.map(x => esc(d.P[x.persona_id]?.nombre || '')).join(', ') : ''}</span></div><span class="chip ${l.length ? 'ok' : ''}">${l.length} enterado${l.length !== 1 ? 's' : ''}</span></div>`; }).join('')}</div></section>`;
  main().querySelector('#avf').onsubmit = async e => { e.preventDefault(); const f = e.target;
    try { await db().insertar('avisos', [{autor_id: C.yo.id, titulo: f.querySelector('#avt').value.trim(), texto: f.querySelector('#avx').value.trim(), nivel: f.querySelector('#avn').value || null}]); vAdminAvisos(); }
    catch (x) { alert('No se pudo publicar: ' + x.message); } };
}

// ---------- Administración: calendario escolar por nivel ----------
const TIPOS_CAL = {sin_clase: ['Sin clases', ''], examen: ['Exámenes', 'aviso'], evento: ['Evento', 'ok'], junta: ['Junta de padres', 'ok'], inicio: ['Inicio', 'ok'], fin: ['Fin de clases', 'ok']};
let filtroCal = '';
async function vAdminCalendario() {
  marcoC('c/admin/calendario', 'Calendario escolar', cargando());
  const cal = await db().leer('calendario', {}, {orden: 'fecha'});
  const ver = cal.filter(c => !filtroCal || !c.nivel || c.nivel === filtroCal);
  const porMes = {}; ver.forEach(c => { const d = deIso(c.fecha), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (porMes[k] ??= []).push(c); });
  const rango = c => c.fecha_fin && c.fecha_fin !== c.fecha ? `Del ${fCorta2(c.fecha)} al ${fCorta2(c.fecha_fin)}` : fLarga(c.fecha);
  main().innerHTML = `
   <section class="tarjeta"><h2>Agregar al calendario</h2><span style="font-size:13px;color:var(--gris)">Lo ven alumnos, papás y profesores del nivel. Los días sin clases no cuentan para la asistencia y desaparecen del pase de lista.</span>
    <form id="calf" style="display:flex;flex-direction:column;gap:10px">
     <div class="form"><label>Qué es<select id="calt">${Object.entries(TIPOS_CAL).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join('')}</select></label><label>Para<select id="caln"><option value="">Toda la escuela</option>${Object.entries(NIVELES).map(([k, t]) => `<option value="${k}" ${k === filtroCal ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Fecha<input type="date" id="calf1" required></label><label>Hasta (si dura varios días)<input type="date" id="calf2"></label></div>
     <label>Título<input id="caltt" required placeholder="Ej. Consejo técnico escolar"></label><label>Detalle (opcional)<input id="cald" placeholder="Ej. Viernes 10:00 · Auditorio"></label>
     <button class="btn" type="submit">Agregar</button></form></section>
   <section class="tarjeta"><div class="tabs" id="calnv">${[['', 'Todos los niveles'], ...Object.entries(NIVELES)].map(([k, t]) => `<button data-n="${k}" class="suave ${filtroCal === k ? 'activo' : ''}">${t}</button>`).join('')}</div>
    ${Object.entries(porMes).map(([k, cs]) => { const [y, m] = k.split('-'); return `<h2 style="font-size:15px;text-transform:capitalize;margin-top:6px">${new Date(+y, +m - 1, 1).toLocaleDateString('es-MX', {month: 'long', year: 'numeric'})}</h2>
     <div class="lista">${cs.map(c => `<div class="it"><span class="chip ${TIPOS_CAL[c.tipo][1]}" style="white-space:nowrap">${TIPOS_CAL[c.tipo][0]}</span><div class="t"><b>${esc(c.titulo)}</b><span>${rango(c)} · ${c.nivel ? NIVELES[c.nivel] : 'Toda la escuela'}${c.descripcion ? ' · ' + esc(c.descripcion) : ''}</span></div><button class="btn sec" data-borra-cal="${c.id}" style="padding:6px 10px;font-size:12px">Quitar</button></div>`).join('')}</div>`; }).join('') || '<div class="vacio">Sin fechas en el calendario.</div>'}</section>`;
  main().onclick = async e => {
    const n = e.target.closest('#calnv button'); if (n) { filtroCal = n.dataset.n; return vAdminCalendario(); }
    const b = e.target.closest('[data-borra-cal]'); if (b && confirm('¿Quitar esta fecha del calendario?')) { try { await db().borrar('calendario', {id: +b.dataset.borraCal}); vAdminCalendario(); } catch (x) { alert('No se pudo quitar: ' + x.message); } }
  };
  main().querySelector('#calf').onsubmit = async e => { e.preventDefault(); const q = id => main().querySelector(id).value.trim();
    if (q('#calf2') && q('#calf2') < q('#calf1')) return alert('La fecha final es antes que la inicial.');
    try { await db().insertar('calendario', [{tipo: q('#calt'), nivel: q('#caln') || null, fecha: q('#calf1'), fecha_fin: q('#calf2') || null, titulo: q('#caltt'), descripcion: q('#cald') || null, creado_por: C.yo.id}]); vAdminCalendario(); }
    catch (x) { alert('No se pudo agregar: ' + x.message); } };
}

// ---------- Administración: pagos y recordatorios de adeudo ----------
// El recordatorio va a los papás si el alumno es menor de edad; si ya tiene 18 años (universidad), al propio alumno.
const edadDe = fn => { if (!fn) return null; const n = deIso(fn), h = new Date(); let e = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--; return e; };
const pesosC = n => '$' + (+n).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
let filtroPagos = '';
async function vAdminPagos() {
  marcoC('c/admin/pagos', 'Pagos', cargando());
  const [pagos, personas, tutores] = await Promise.all([db().leer('pagos', {}, {orden: 'vence'}), db().leer('personas', {rol: ['alumno', 'padre']}), db().leer('tutores')]);
  const P = porId(personas), hoy = iso(new Date()), mes = hoy.slice(0, 7);
  const venc = pagos.filter(p => !p.pagado_en && p.vence < hoy), porAlumno = {};
  venc.forEach(p => (porAlumno[p.alumno_id] ??= []).push(p));
  const destino = a => { const e = edadDe(a.fecha_nacimiento); if (e != null && e >= 18) return {ids: [a.id], txt: 'Al alumno (mayor de edad)', sinCuenta: !a.auth_id};
    const t = tutores.filter(x => x.alumno_id === a.id && P[x.padre_id]); return t.length ? {ids: t.map(x => x.padre_id), txt: t.map(x => `${x.parentesco}: ${P[x.padre_id].nombre}`).join(', '), sinCuenta: t.every(x => !P[x.padre_id].auth_id)} : {ids: [], txt: 'Sin tutor registrado', sinCuenta: true}; };
  const filas = Object.entries(porAlumno).map(([id, ps]) => ({a: P[id], ps, total: ps.reduce((s, p) => s + +p.monto, 0), rec: ps.map(p => p.recordado_en).filter(Boolean).sort().at(-1)})).filter(x => x.a && (!filtroPagos || x.a.nivel === filtroPagos)).sort((x, y) => y.total - x.total);
  const cobrado = pagos.filter(p => p.pagado_en && p.pagado_en.slice(0, 7) === mes).reduce((s, p) => s + +p.monto, 0);
  main().innerHTML = `
   <div class="rejilla">
    <section class="tarjeta dato"><small>Vencido por cobrar</small><b style="color:${venc.length ? 'var(--mal)' : 'var(--ok)'}">${pesosC(venc.reduce((s, p) => s + +p.monto, 0))}</b><span>${Object.keys(porAlumno).length} alumno${Object.keys(porAlumno).length !== 1 ? 's' : ''} con adeudo</span></section>
    <section class="tarjeta dato"><small>Cobrado este mes</small><b>${pesosC(cobrado)}</b><span>${pagos.filter(p => p.pagado_en && p.pagado_en.slice(0, 7) === mes).length} pagos</span></section>
    <section class="tarjeta dato"><small>Por vencer</small><b>${pagos.filter(p => !p.pagado_en && p.vence >= hoy).length}</b><span>pagos del ciclo</span></section>
   </div>
   <section class="tarjeta"><div class="fila" style="flex-wrap:wrap"><div><h2>Adeudos</h2><span style="font-size:13px;color:var(--gris)">El recordatorio llega a Mensajes: a los papás si el alumno es menor de edad, o al alumno si ya cumplió 18.</span></div>${filas.length ? `<button class="btn" id="precall" style="padding:9px 14px;font-size:13px">Recordar a todos (${filas.filter(x => destino(x.a).ids.length).length})</button>` : ''}</div>
    <div class="tabs" id="pnv">${[['', 'Todos'], ...Object.entries(NIVELES)].map(([k, t]) => `<button data-n="${k}" class="suave ${filtroPagos === k ? 'activo' : ''}">${t}</button>`).join('')}</div>
    <div class="lista">${filas.map(x => { const d = destino(x.a); return `<div class="it" style="flex-wrap:wrap;align-items:flex-start"><div class="t" style="min-width:220px"><b>${esc(x.a.nombre)}</b><span>${NIVELES[x.a.nivel] || ''} · ${esc(x.a.grado || '')} · ${x.ps.map(p => esc(p.concepto)).join(', ')}</span><span style="display:block">${ic('msg', 'style="width:12px;height:12px;vertical-align:-1px"')} ${esc(d.txt)}${d.sinCuenta && d.ids.length ? ' · sin cuenta en la plataforma' : ''}${x.rec ? ' · último recordatorio ' + hora(x.rec) : ''}</span></div>
      <b style="color:var(--mal);white-space:nowrap">${pesosC(x.total)}</b>
      <div style="display:flex;gap:6px"><button class="btn" data-recordar="${x.a.id}" ${d.ids.length ? '' : 'disabled style="opacity:.5"'} style="padding:8px 12px;font-size:13px">${x.rec ? 'Recordar otra vez' : 'Enviar recordatorio'}</button><button class="btn sec" data-pagado="${x.a.id}" style="padding:8px 12px;font-size:13px">Registrar pago</button></div></div>`; }).join('') || `<div class="vacio">${ic('check')}Nadie tiene pagos vencidos${filtroPagos ? ' en ' + NIVELES[filtroPagos].toLowerCase() : ''}.</div>`}</div></section>`;
  const recordar = async id => {
    const x = filas.find(f => f.a.id === id), d = destino(x.a); if (!d.ids.length) return;
    const nombre = x.a.nombre.split(' ')[0], conceptos = x.ps.map(p => p.concepto.toLowerCase()).join(', ');
    const texto = d.ids[0] === x.a.id
      ? `Hola, ${nombre}. Te recordamos que tienes pendiente ${conceptos} por ${pesosC(x.total)} (venció el ${fCorta2(x.ps[0].vence)}). Puedes pagar en línea desde la sección Pagos del portal. Si ya pagaste, ignora este mensaje.`
      : `Buen día. Le recordamos que está pendiente ${conceptos} de ${nombre} por ${pesosC(x.total)} (venció el ${fCorta2(x.ps[0].vence)}). Puede pagar en línea desde la sección Colegiaturas del portal. Si ya pagó, por favor ignore este mensaje.`;
    await db().insertar('mensajes', d.ids.map(para => ({de: C.yo.id, para, texto})));
    await db().actualizar('pagos', {recordado_en: new Date().toISOString()}, {id: x.ps.map(p => p.id)});
  };
  main().onclick = async e => {
    const n = e.target.closest('#pnv button'); if (n) { filtroPagos = n.dataset.n; return vAdminPagos(); }
    const r = e.target.closest('[data-recordar]'); if (r) { r.disabled = true; try { await recordar(r.dataset.recordar); vAdminPagos(); } catch (x) { alert('No se pudo enviar: ' + x.message); r.disabled = false; } return; }
    const pg = e.target.closest('[data-pagado]'); if (pg) { const x = filas.find(f => f.a.id === pg.dataset.pagado); if (!confirm(`¿Registrar como pagado ${x.ps.map(p => p.concepto).join(', ')} de ${x.a.nombre} (${pesosC(x.total)})?`)) return;
      try { await db().actualizar('pagos', {pagado_en: hoy}, {id: x.ps.map(p => p.id)}); vAdminPagos(); } catch (x2) { alert('No se pudo guardar: ' + x2.message); } return; }
    if (e.target.id === 'precall') { const con = filas.filter(x => destino(x.a).ids.length); if (!confirm(`¿Enviar el recordatorio a ${con.length} familias o alumnos?`)) return; e.target.disabled = true;
      try { for (const x of con) await recordar(x.a.id); alert(`Listo: se enviaron ${con.length} recordatorios.`); vAdminPagos(); } catch (x) { alert('No se pudo enviar: ' + x.message); e.target.disabled = false; } }
  };
}

// =====================================================================
// Administración: grupos (armarlos, asignar profesores, mover alumnos, bajas y transferencias) e importación desde Excel
// =====================================================================
const normal = t => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const slug = t => normal(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase();
const nivelDe = t => { const n = normal(t); return n.startsWith('kin') || n.startsWith('pree') ? 'kinder' : n.startsWith('prim') ? 'primaria' : n.startsWith('sec') ? 'secundaria' : n.startsWith('bach') || n.startsWith('prepa') ? 'bachillerato' : n.startsWith('uni') || n.startsWith('lic') ? 'universidad' : null; };
const DIAS_ABR = {lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6, dom: 7};
function diasDe(t) {
  const n = normal(t); if (!n) return [];
  const r = n.match(/^(lun|mar|mie|jue|vie|sab|dom)\w*\.? a (lun|mar|mie|jue|vie|sab|dom)/);
  if (r) { const o = []; for (let d = DIAS_ABR[r[1]]; d <= DIAS_ABR[r[2]]; d++) o.push(d); return o; }
  return [...new Set((n.match(/lun|mar|mie|jue|vie|sab|dom/g) || []).map(x => DIAS_ABR[x]))].sort();
}
const horaDe = v => { if (typeof v === 'number' && v < 1) { const m = Math.round(v * 1440); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
  const r = String(v ?? '').match(/(\d{1,2})[:.](\d{2})/); return r ? `${r[1].padStart(2, '0')}:${r[2]}` : null; };
const fechaDe = v => { if (typeof v === 'number' && v > 1000) return iso(new Date(Date.UTC(1899, 11, 30) + v * 864e5 + 43200000));
  const t = String(v ?? '').trim(); let r = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); if (r) return `${r[3]}-${r[2].padStart(2, '0')}-${r[1].padStart(2, '0')}`;
  r = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return r ? r[0] : null; };
const DIA_TXT = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const horarioCortoC = h => { const por = {}; (h || []).forEach(x => (por[`${x.inicio}–${x.fin}`] ??= []).push(+x.dia));
  return Object.entries(por).map(([t, ds]) => { ds.sort(); const seg = ds.length > 2 && ds.every((d, k) => !k || d === ds[k - 1] + 1); return `${seg ? DIA_TXT[ds[0]] + ' a ' + DIA_TXT[ds.at(-1)] : ds.map(d => DIA_TXT[d]).join(', ')} ${t}`; }).join(' · ') || 'Sin horario'; };
const nomMateria = g => /^Grupo/.test(g.materia) ? 'Titular' : g.materia;

// ---------- Lector de Excel (.xlsx) y CSV, sin librerías ----------
async function leerHojas(archivo) {
  const buf = await archivo.arrayBuffer();
  if (/\.csv$/i.test(archivo.name) || archivo.type === 'text/csv') return {Hoja1: leerCSV(new TextDecoder().decode(buf))};
  const u8 = new Uint8Array(buf), dv = new DataView(buf), td = new TextDecoder();
  let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const n = dv.getUint16(e + 10, true), arch = {}; let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) { const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    arch[td.decode(u8.subarray(p + 46, p + 46 + nl))] = {metodo: dv.getUint16(p + 10, true), tam: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true)}; p += 46 + nl + xl + cl; }
  const leer = async nombre => { const f = arch[nombre]; if (!f) return null; const ini = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), datos = u8.subarray(ini, ini + f.tam);
    if (f.metodo === 0) return td.decode(datos); return new Response(new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); };
  const xml = t => new DOMParser().parseFromString(t, 'application/xml'), etiquetas = (n2, t) => [...n2.getElementsByTagName(t)];
  const ss = [], sst = await leer('xl/sharedStrings.xml');
  if (sst) for (const si of etiquetas(xml(sst), 'si')) ss.push(etiquetas(si, 't').map(t => t.textContent).join(''));
  const rels = {}; for (const r of etiquetas(xml(await leer('xl/_rels/workbook.xml.rels')), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const col = ref => { let c = 0; for (const ch of ref.replace(/\d+/g, '')) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  const hojas = {};
  for (const sh of etiquetas(xml(await leer('xl/workbook.xml')), 'sheet')) {
    let t = rels[sh.getAttribute('r:id')] || ''; t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    const doc = await leer(t); if (!doc) continue;
    hojas[sh.getAttribute('name')] = etiquetas(xml(doc), 'row').map(row => { const fila = [];
      for (const c of etiquetas(row, 'c')) { const tipo = c.getAttribute('t'), v = c.getElementsByTagName('v')[0]?.textContent;
        fila[col(c.getAttribute('r'))] = tipo === 's' ? ss[+v] : tipo === 'inlineStr' ? etiquetas(c, 't').map(x => x.textContent).join('') : tipo === 'str' ? v : v == null ? '' : isNaN(+v) ? v : +v; }
      return fila; });
  }
  return hojas;
}
function leerCSV(t) {
  t = t.replace(/^﻿/, ''); const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], campo = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') q = false; else campo += c; }
    else if (c === '"') q = true; else if (c === sep) { fila.push(campo); campo = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; } else campo += c; }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}
// Convierte una hoja en objetos con las columnas conocidas (no importa el orden ni los acentos).
const COLUMNAS = {nivel: 'nivel', grupo: 'grupo', salon: 'grupo', materia: 'materia', asignatura: 'materia', profesor: 'profesor', maestro: 'profesor', docente: 'profesor', dias: 'dias', inicio: 'inicio', 'hora inicio': 'inicio', fin: 'fin', 'hora fin': 'fin', aula: 'aula',
  nombre: 'nombre', alumno: 'nombre', 'nombre completo': 'nombre', grado: 'grado', matricula: 'matricula', 'fecha de nacimiento': 'nacimiento', nacimiento: 'nacimiento', tutor: 'tutor', 'mama o papa': 'tutor', parentesco: 'parentesco'};
function aObjetos(filas) {
  const cab = (filas[0] || []).map(c => COLUMNAS[normal(c)] || null);
  return filas.slice(1).map((f, i) => { const o = {_fila: i + 2}; cab.forEach((k, j) => { if (k) o[k] = typeof f[j] === 'string' ? f[j].trim() : f[j]; }); return o; })
    .filter(o => Object.keys(o).some(k => k !== '_fila' && o[k] !== '' && o[k] != null));
}

// ---------- Datos y utilidades de grupos ----------
async function datosGrupos() {
  const [grupos, ins, personas, tutores, movs] = await Promise.all([db().leer('grupos', {}, {orden: 'id'}), db().leer('inscripciones'), db().leer('personas', {}, {orden: 'nombre'}), db().leer('tutores'), db().leer('movimientos', {}, {orden: 'fecha', desc: true})]);
  const P = porId(personas), salones = {};
  for (const g of grupos) { const k = `${g.nivel}|${g.nombre}`; (salones[k] ??= {k, nivel: g.nivel, nombre: g.nombre, grupos: [], alumnos: new Set()}).grupos.push(g); }
  for (const i of ins) { const g = grupos.find(x => x.id === i.grupo_id); if (g && P[i.alumno_id]?.rol === 'alumno') salones[`${g.nivel}|${g.nombre}`].alumnos.add(i.alumno_id); }
  return {grupos, ins, personas, P, tutores, movs, salones};
}
const salonDe = (d, alumnoId, nivel) => Object.values(d.salones).find(s => (!nivel || s.nivel === nivel) && s.alumnos.has(alumnoId));
async function inscribir(alumnoId, salon, yaInscrito = []) {
  const filas = salon.grupos.filter(g => !yaInscrito.some(i => i.grupo_id === g.id && i.alumno_id === alumnoId)).map(g => ({grupo_id: g.id, alumno_id: alumnoId}));
  if (filas.length) await db().insertar('inscripciones', filas);
}
const sacar = (alumnoId, salon) => db().borrar('inscripciones', {alumno_id: alumnoId, grupo_id: salon.grupos.map(g => g.id)});
// Avisa a los papás (o al alumno si ya es mayor de edad) con un mensaje de control escolar.
async function avisarFamilia(d, a, texto) {
  const e = edadDe(a.fecha_nacimiento), para = e != null && e >= 18 ? [a.id] : d.tutores.filter(t => t.alumno_id === a.id).map(t => t.padre_id);
  if (para.length) await db().insertar('mensajes', para.map(p => ({de: C.yo.id, para: p, texto})));
  return para.length;
}

let estGrupos = {nivel: 'secundaria', salon: null, accion: null, plan: null};
const MOTIVOS = ['Conducta', 'Rendimiento académico', 'A petición de la familia', 'Reacomodo de grupos', 'Otro'];
async function vAdminGrupos() {
  marcoC('c/admin/grupos', 'Grupos', cargando());
  const d = await datosGrupos(), profes = d.personas.filter(p => p.rol === 'profesor'), st = estGrupos;
  const salones = Object.values(d.salones).filter(s => s.nivel === st.nivel).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const S = st.salon && d.salones[st.salon];
  const optProf = (nivel, sel) => `<option value="">Sin asignar</option>${profes.filter(p => !nivel || p.nivel === nivel || p.id === sel).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}${p.auth_id ? '' : ' (sin cuenta)'}</option>`).join('')}`;
  const movHTML = m => { const a = d.P[m.alumno_id]; return `<div class="it" style="align-items:flex-start"><span class="chip ${m.tipo === 'baja' ? 'mal' : m.tipo === 'transferencia' || m.tipo === 'cambio_grupo' ? 'aviso' : 'ok'}" style="white-space:nowrap">${{alta: 'Alta', cambio_grupo: 'Cambio de grupo', baja: 'Baja', transferencia: 'Transferencia'}[m.tipo]}</span><div class="t"><b>${esc(a?.nombre || 'Alumno')}</b><span>${m.de_grupo ? esc(m.de_grupo) : ''}${m.de_grupo && (m.a_grupo || m.escuela_destino) ? ' → ' : ''}${esc(m.a_grupo || m.escuela_destino || '')}${m.motivo ? ' · ' + esc(m.motivo) : ''}${m.detalle ? ' · ' + esc(m.detalle) : ''} · ${hora(m.fecha)}</span></div></div>`; };

  let cuerpo;
  if (S) {
    const alumnos = [...S.alumnos].map(id => d.P[id]).filter(Boolean).sort((a, b) => a.nombre.localeCompare(b.nombre));
    const otros = Object.values(d.salones).filter(x => x.nivel === S.nivel && x.k !== S.k);
    const sinSalon = d.personas.filter(p => p.rol === 'alumno' && p.nivel === S.nivel && (p.estado || 'activo') === 'activo' && !salonDe(d, p.id, S.nivel));
    const panel = a => { const ac = st.accion; if (!ac || ac.id !== a.id) return '';
      if (ac.tipo === 'mover') return `<form class="panel-acc" data-mover="${a.id}" style="display:flex;flex-direction:column;gap:10px;width:100%;background:var(--fondo);border-radius:14px;padding:12px">
        <div class="form"><label>Pasar a<select name="destino" required>${otros.map(o => `<option value="${esc(o.k)}">${esc(o.nombre)} (${o.alumnos.size} alumnos)</option>`).join('') || '<option value="">No hay otro grupo de este nivel</option>'}</select></label><label>Motivo<select name="motivo">${MOTIVOS.map(m => `<option>${m}</option>`).join('')}</select></label></div>
        <label>Detalle (queda en el historial)<input name="detalle" placeholder="Ej. Acuerdo con la familia después de varios reportes"></label>
        <label style="flex-direction:row;align-items:center;gap:8px;color:var(--tinta)"><input type="checkbox" name="avisar" checked style="width:auto"> Avisar a sus papás por mensaje${edadDe(a.fecha_nacimiento) >= 18 ? ' (es mayor de edad: se le avisa a él)' : ''}</label>
        <div style="display:flex;gap:8px"><button class="btn" type="submit" ${otros.length ? '' : 'disabled'}>Cambiar de grupo</button><button class="btn sec" type="button" data-cancelar>Cancelar</button></div></form>`;
      return `<form class="panel-acc" data-baja="${a.id}" style="display:flex;flex-direction:column;gap:10px;width:100%;background:var(--malf);border-radius:14px;padding:12px">
        <div class="form"><label>Tipo<select name="tipo"><option value="transferencia">Transferencia a otra escuela</option><option value="baja">Baja</option></select></label><label>Escuela a la que se va (si se sabe)<input name="escuela" placeholder="Ej. Secundaria Técnica 12"></label></div>
        <div class="form"><label>Motivo<select name="motivo">${['Conducta', 'Cambio de domicilio', 'A petición de la familia', 'Situación económica', 'Otro'].map(m => `<option>${m}</option>`).join('')}</select></label><label>Detalle<input name="detalle" required placeholder="Ej. Se acordó con la familia la transferencia"></label></div>
        <span style="font-size:12px;color:var(--gris)">Se le quita de sus grupos y su expediente queda guardado con el historial. Su asistencia y calificaciones no se borran.</span>
        <label style="flex-direction:row;align-items:center;gap:8px;color:var(--tinta)"><input type="checkbox" name="avisar" checked style="width:auto"> Avisar a sus papás por mensaje</label>
        <div style="display:flex;gap:8px"><button class="btn" type="submit" style="background:var(--mal)">Registrar</button><button class="btn sec" type="button" data-cancelar>Cancelar</button></div></form>`; };
    cuerpo = `<section class="tarjeta"><div class="fila" style="flex-wrap:wrap"><div><h2>${esc(S.nombre)}</h2><span style="font-size:13px;color:var(--gris)">${NIVELES[S.nivel]} · ${S.alumnos.size} alumnos · ${S.grupos.length} materia${S.grupos.length !== 1 ? 's' : ''}</span></div><button class="btn sec" data-salon="" style="padding:8px 12px;font-size:13px">← Todos los grupos</button></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Materia</th><th>Profesor</th><th class="ocultar-movil">Horario</th><th class="ocultar-movil">Aula</th></tr></thead><tbody>${S.grupos.map(g => `<tr><td>${esc(nomMateria(g))}</td><td><select data-prof="${g.id}" style="padding:8px 10px;min-width:180px">${optProf(S.nivel, g.profesor_id)}</select></td><td class="ocultar-movil">${horarioCortoC(g.horario)}</td><td class="ocultar-movil">${esc(g.aula || '')}</td></tr>`).join('')}</tbody></table></div>
      <span style="font-size:12px;color:var(--gris)">Al cambiar el profesor, el nuevo ve el grupo con su lista, tareas y calificaciones desde ese momento.</span></section>
     <section class="tarjeta"><div class="fila" style="flex-wrap:wrap"><h2>Alumnos</h2>${sinSalon.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><select id="gagr" style="padding:8px 10px;min-width:200px">${sinSalon.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select><button class="btn" id="gagrb" style="padding:8px 12px;font-size:13px">Agregar al grupo</button></div>` : ''}</div>
      <div class="lista">${alumnos.map(a => { const e = edadDe(a.fecha_nacimiento); return `<div class="it" style="flex-wrap:wrap"><span class="avatar" style="width:36px;height:36px;font-size:12px;color:#fff;background:#8C7FA0">${iniciales(a.nombre)}</span><div class="t" style="min-width:180px"><b>${esc(a.nombre)}</b><span>${esc(a.usuario || '')}${e != null ? ' · ' + e + ' años' : ''}${d.movs.some(m => m.alumno_id === a.id) ? ' · ya tuvo cambios (ver historial)' : ''}</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sec" data-acc="mover" data-al="${a.id}" style="padding:8px 12px;font-size:13px">Cambiar de grupo</button><button class="btn sec" data-acc="baja" data-al="${a.id}" style="padding:8px 12px;font-size:13px;color:var(--mal)">Baja o transferencia</button></div>${panel(a)}</div>`; }).join('') || '<div class="vacio">Este grupo no tiene alumnos.</div>'}</div></section>`;
  } else {
    cuerpo = `<div class="rejilla">${salones.map(x => `<a class="tarjeta" href="#" data-salon="${esc(x.k)}" style="color:inherit"><div class="fila"><h2>${esc(x.nombre)}</h2><span class="chip">${x.alumnos.size} alumnos</span></div>
      <div class="lista">${x.grupos.map(g => `<div class="it" style="padding:6px 0"><div class="t"><b style="font-size:14px">${esc(nomMateria(g))}</b><span>${esc(d.P[g.profesor_id]?.nombre || 'Sin profesor')} · ${horarioCortoC(g.horario)}</span></div></div>`).join('')}</div></a>`).join('') || `<div class="vacio">${ic('perfil')}No hay grupos de ${NIVELES[st.nivel].toLowerCase()}. Créalos aquí o impórtalos desde Excel.</div>`}</div>`;
  }
  const movs = d.movs.filter(m => d.P[m.alumno_id]?.nivel === st.nivel).slice(0, 12);
  main().innerHTML = `
   <section class="tarjeta"><div class="fila" style="flex-wrap:wrap;gap:8px"><div><h2>Armar grupos</h2><span style="font-size:13px;color:var(--gris)">Qué profesor da cada materia y qué alumnos hay en cada grupo. A mano o desde un Excel.</span></div>
     <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn sec" id="gnueva" style="padding:9px 14px;font-size:13px">+ Grupo o materia</button><label class="btn" style="padding:9px 14px;font-size:13px;cursor:pointer;flex-direction:row;color:#fff">${ic('subir', 'style="width:16px;height:16px"')} Importar desde Excel<input type="file" id="gimp" accept=".xlsx,.csv" hidden></label><a class="btn sec" href="plantilla_grupos.xlsx" download style="padding:9px 14px;font-size:13px">${ic('bajar', 'style="width:16px;height:16px;vertical-align:-3px"')} Plantilla</a></div></div>
    <div class="tabs" id="gnv">${Object.entries(NIVELES).map(([k, t]) => `<button data-n="${k}" class="suave ${st.nivel === k ? 'activo' : ''}">${t} (${Object.values(d.salones).filter(x => x.nivel === k).length})</button>`).join('')}</div>
    <form id="gnf" class="oculto" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--linea);padding-top:12px">
     <div class="form"><label>Grupo<input name="grupo" list="gsal" required placeholder="Ej. Secundaria 2.º E" value="${S ? esc(S.nombre) : ''}"><datalist id="gsal">${salones.map(x => `<option value="${esc(x.nombre)}">`).join('')}</datalist></label><label>Materia<input name="materia" required placeholder="${st.nivel === 'kinder' || st.nivel === 'primaria' ? 'Titular, Inglés…' : 'Ej. Matemáticas II'}"></label>
      <label>Profesor<select name="prof">${optProf(st.nivel)}</select></label><label>Aula<input name="aula" placeholder="Ej. Salón 9"></label></div>
     <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><span style="font-size:13px;font-weight:600;color:var(--gris)">Días</span>${[1, 2, 3, 4, 5, 6].map(x => `<label style="flex-direction:row;align-items:center;gap:4px;color:var(--tinta)"><input type="checkbox" name="dia" value="${x}" ${x < 6 && st.nivel !== 'universidad' ? 'checked' : ''} style="width:auto">${DIA_TXT[x]}</label>`).join('')}</div>
     <div class="form"><label>Hora de inicio<input type="time" name="ini" value="08:00" required></label><label>Hora de fin<input type="time" name="fin" value="09:00" required></label></div>
     <button class="btn" type="submit">Guardar materia</button></form>
    <div id="gplan">${st.plan ? planHTML(st.plan) : ''}</div></section>
   ${cuerpo}
   <section class="tarjeta"><h2>Historial de cambios · ${NIVELES[st.nivel]}</h2><div class="lista">${movs.map(movHTML).join('') || '<div class="vacio">Sin cambios de grupo, bajas ni transferencias.</div>'}</div></section>`;

  const recargar = () => vAdminGrupos();
  main().onclick = async e => {
    const nv = e.target.closest('#gnv button'); if (nv) { Object.assign(st, {nivel: nv.dataset.n, salon: null, accion: null}); return recargar(); }
    const sl = e.target.closest('[data-salon]'); if (sl) { e.preventDefault(); Object.assign(st, {salon: sl.dataset.salon || null, accion: null}); return recargar(); }
    if (e.target.id === 'gnueva') return main().querySelector('#gnf').classList.toggle('oculto');
    const ac = e.target.closest('[data-acc]'); if (ac) { st.accion = st.accion?.id === ac.dataset.al && st.accion.tipo === ac.dataset.acc ? null : {id: ac.dataset.al, tipo: ac.dataset.acc}; const y = scrollY; await recargar(); return scrollTo(0, y); }
    if (e.target.closest('[data-cancelar]')) { st.accion = null; const y = scrollY; await recargar(); return scrollTo(0, y); }
    if (e.target.id === 'gagrb') { const id = main().querySelector('#gagr').value; e.target.disabled = true;
      try { await inscribir(id, S, d.ins); await db().insertar('movimientos', [{alumno_id: id, tipo: 'alta', a_grupo: S.nombre, motivo: 'Asignación de grupo', hecho_por: C.yo.id}]); recargar(); } catch (x) { alert('No se pudo agregar: ' + x.message); e.target.disabled = false; } }
    if (e.target.id === 'gimpok') return importar(st.plan, e.target);
    if (e.target.id === 'gimpno') { st.plan = null; return recargar(); }
  };
  main().onchange = async e => {
    const pr = e.target.closest('[data-prof]'); if (pr) { try { await db().actualizar('grupos', {profesor_id: pr.value || null}, {id: pr.dataset.prof}); pr.style.borderColor = 'var(--ok)'; } catch (x) { alert('No se pudo cambiar: ' + x.message); } }
    if (e.target.id === 'gimp' && e.target.files[0]) { const f = e.target.files[0]; main().querySelector('#gplan').innerHTML = `<div class="vacio">${ic('reloj')}Leyendo ${esc(f.name)}…</div>`;
      try { st.plan = analizarImport(await leerHojas(f), d); st.plan.archivo = f.name; } catch (x) { st.plan = null; main().querySelector('#gplan').innerHTML = `<div class="vacio" style="color:var(--mal)">${ic('cerrar')}No se pudo leer el archivo: ${esc(x.message)}</div>`; return; }
      main().querySelector('#gplan').innerHTML = planHTML(st.plan); main().querySelector('#gplan').scrollIntoView({block: 'start', behavior: 'smooth'}); }
  };
  main().onsubmit = async e => {
    e.preventDefault(); const f = e.target, v = n => f.elements[n]?.value?.trim(), btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (f.id === 'gnf') {
        const dias = [...f.querySelectorAll('[name=dia]:checked')].map(x => +x.value); if (!dias.length) throw new Error('Elige al menos un día.');
        const materia = normal(v('materia')) === 'titular' ? 'Grupo (titular)' : v('materia'), existe = d.grupos.find(g => g.nivel === st.nivel && normal(g.nombre) === normal(v('grupo')) && normal(g.materia) === normal(materia));
        const fila = {nombre: v('grupo'), nivel: st.nivel, materia, profesor_id: v('prof') || null, horario: dias.map(x => ({dia: x, inicio: v('ini'), fin: v('fin')})), aula: v('aula') || null};
        if (existe) await db().actualizar('grupos', fila, {id: existe.id}); else await db().insertar('grupos', [{id: idNuevo(d, fila.nombre, materia), ...fila}]);
        st.salon = `${st.nivel}|${fila.nombre}`; return recargar();
      }
      const a = d.P[f.dataset.mover || f.dataset.baja];
      if (f.dataset.mover) {
        const dest = d.salones[v('destino')]; if (!dest) throw new Error('Elige el grupo al que pasa.');
        await sacar(a.id, S); await inscribir(a.id, dest);
        await db().insertar('movimientos', [{alumno_id: a.id, tipo: 'cambio_grupo', de_grupo: S.nombre, a_grupo: dest.nombre, motivo: v('motivo'), detalle: v('detalle') || null, hecho_por: C.yo.id}]);
        if (f.elements.avisar.checked) await avisarFamilia(d, a, `Le informamos que ${a.nombre.split(' ')[0]} cambia del grupo ${S.nombre} al ${dest.nombre} a partir de hoy. Motivo: ${v('motivo').toLowerCase()}${v('detalle') ? ' (' + v('detalle') + ')' : ''}. Cualquier duda, estamos a sus órdenes en control escolar.`);
        if (v('motivo') === 'Conducta') await db().insertar('anotaciones', [{alumno_id: a.id, autor_id: C.yo.id, grupo_id: dest.grupos[0]?.id || null, tipo: 'conducta', texto: `Cambio de grupo por conducta (${S.nombre} → ${dest.nombre}).${v('detalle') ? ' ' + v('detalle') : ''}`, visible_padres: true}]);
        st.accion = null; alert(`${a.nombre} ahora está en ${dest.nombre}. Sus nuevos profesores ya lo ven en su lista.`); return recargar();
      }
      if (f.dataset.baja) {
        const tipo = v('tipo'); if (!confirm(`¿Registrar la ${tipo === 'baja' ? 'baja' : 'transferencia'} de ${a.nombre}? Se le quita de todos sus grupos.`)) { btn.disabled = false; return; }
        await db().borrar('inscripciones', {alumno_id: a.id}); await db().actualizar('personas', {estado: tipo === 'baja' ? 'baja' : 'transferido'}, {id: a.id});
        await db().insertar('movimientos', [{alumno_id: a.id, tipo, de_grupo: S.nombre, escuela_destino: v('escuela') || null, motivo: v('motivo'), detalle: v('detalle'), hecho_por: C.yo.id}]);
        if (f.elements.avisar.checked) await avisarFamilia(d, a, tipo === 'baja' ? `Le confirmamos que quedó registrada la baja de ${a.nombre.split(' ')[0]}. Su expediente y documentos están disponibles en control escolar.` : `Le confirmamos el trámite de transferencia de ${a.nombre.split(' ')[0]}${v('escuela') ? ' a ' + v('escuela') : ''}. Su expediente, boletas y documentos están listos en control escolar para entregarse a la nueva escuela.`);
        st.accion = null; return recargar();
      }
    } catch (x) { alert('No se pudo guardar: ' + x.message); btn.disabled = false; }
  };
}
function idNuevo(d, nombre, materia) {
  let base = (slug(nombre) + (/^Grupo/.test(materia) ? '' : '-' + slug(materia).slice(0, 12))).slice(0, 40).replace(/-+$/, '') || 'G', id = base, k = 2;
  while (d.grupos.some(g => g.id === id)) id = `${base}-${k++}`;
  d.grupos.push({id}); return id;
}

// ---------- Importación: primero se revisa, luego se guarda ----------
function analizarImport(hojas, d) {
  let filasG = [], filasA = [];
  for (const [nombre, filas] of Object.entries(hojas)) { const objs = aObjetos(filas), n = normal(nombre);
    if (n.startsWith('grupo') || (objs[0] && 'materia' in objs[0])) filasG = filasG.concat(objs);
    else if (n.startsWith('alumno') || (objs[0] && 'nombre' in objs[0])) filasA = filasA.concat(objs); }
  if (!filasG.length && !filasA.length) throw new Error('No encontré las hojas "Grupos" ni "Alumnos". Usa la plantilla.');
  const avisos = [], profesNuevos = new Map(), grupos = [], alumnos = [], salonesNuevos = new Set();
  const profPorNombre = n => d.personas.find(p => p.rol === 'profesor' && normal(p.nombre) === normal(n));
  for (const r of filasG) {
    const nivel = nivelDe(r.nivel) || nivelDe(r.grupo); if (!nivel || !r.grupo || !r.materia) { avisos.push(`Grupos, fila ${r._fila}: falta el nivel, el grupo o la materia.`); continue; }
    const materia = normal(r.materia) === 'titular' ? 'Grupo (titular)' : String(r.materia), dias = diasDe(r.dias), ini = horaDe(r.inicio), fin = horaDe(r.fin);
    if (!dias.length || !ini || !fin) avisos.push(`Grupos, fila ${r._fila} (${r.grupo} · ${r.materia}): el horario no está completo; se guarda sin horario.`);
    let prof = null; if (r.profesor) { prof = profPorNombre(r.profesor); if (!prof && !profesNuevos.has(normal(r.profesor))) profesNuevos.set(normal(r.profesor), {nombre: String(r.profesor), nivel, materia: nomMateria({materia})}); }
    const existe = d.grupos.find(g => g.nivel === nivel && normal(g.nombre) === normal(r.grupo) && normal(g.materia) === normal(materia));
    if (!d.salones[`${nivel}|${d.grupos.find(g => g.nivel === nivel && normal(g.nombre) === normal(r.grupo))?.nombre}`]) salonesNuevos.add(`${nivel}|${r.grupo}`);
    grupos.push({accion: existe ? 'actualizar' : 'nueva', existe, nivel, nombre: existe?.nombre || String(r.grupo), materia, profesor: r.profesor ? String(r.profesor) : '', profId: prof?.id || null,
      horario: dias.length && ini && fin ? dias.map(x => ({dia: x, inicio: ini, fin})) : [], aula: r.aula ? String(r.aula) : null, cambia: existe && (existe.profesor_id !== (prof?.id || existe.profesor_id) || (r.aula && existe.aula !== String(r.aula)))});
  }
  const salonExiste = (nivel, nombre) => Object.values(d.salones).find(s => s.nivel === nivel && normal(s.nombre) === normal(nombre)) || (grupos.some(g => g.nivel === nivel && normal(g.nombre) === normal(nombre)) ? {nombre: grupos.find(g => g.nivel === nivel && normal(g.nombre) === normal(nombre)).nombre, nuevo: true} : null);
  for (const r of filasA) {
    const nivel = nivelDe(r.nivel) || nivelDe(r.grupo); if (!r.nombre || !nivel || !r.grupo) { avisos.push(`Alumnos, fila ${r._fila}: falta el nombre, el nivel o el grupo.`); continue; }
    const sal = salonExiste(nivel, r.grupo); if (!sal) { avisos.push(`Alumnos, fila ${r._fila} (${r.nombre}): el grupo "${r.grupo}" no existe ni viene en la hoja Grupos; no se importa.`); continue; }
    const mat = r.matricula != null && r.matricula !== '' ? String(r.matricula) : null;
    const ya = d.personas.find(p => p.rol === 'alumno' && ((mat && p.usuario === mat) || (normal(p.nombre) === normal(r.nombre) && p.nivel === nivel)));
    const actual = ya && salonDe(d, ya.id, nivel);
    if (ya && mat && ya.usuario === mat && normal(ya.nombre) !== normal(r.nombre)) avisos.push(`Alumnos, fila ${r._fila}: la matrícula ${mat} es de ${ya.nombre}, pero en el archivo dice "${r.nombre}". Se usa el alumno de esa matrícula.`);
    const accion = !ya ? 'nuevo' : actual && normal(actual.nombre) === normal(sal.nombre) ? 'igual' : actual ? 'mover' : 'inscribir';
    if (ya && ya.estado && ya.estado !== 'activo') avisos.push(`Alumnos, fila ${r._fila}: ${ya.nombre} estaba dado de baja o transferido; se reactiva.`);
    const nac = r.nacimiento ? fechaDe(r.nacimiento) : null; if (r.nacimiento && !nac) avisos.push(`Alumnos, fila ${r._fila}: no entendí la fecha de nacimiento "${r.nacimiento}".`);
    alumnos.push({accion, ya, actual, nivel, salon: sal.nombre, nombre: String(r.nombre), grado: r.grado ? String(r.grado) : null, matricula: mat, nacimiento: nac, tutor: r.tutor ? String(r.tutor) : '', parentesco: r.parentesco ? String(r.parentesco) : 'Mamá'});
  }
  return {grupos, alumnos, profesNuevos: [...profesNuevos.values()], avisos, salonesNuevos: [...salonesNuevos]};
}
function planHTML(p) {
  const n = (l, a) => l.filter(x => x.accion === a).length, chip = (t, c = '') => `<span class="chip ${c}">${t}</span>`;
  const sinCambio = n(p.alumnos, 'igual') + p.grupos.filter(g => g.accion === 'actualizar' && !g.cambia).length;
  return `<div style="display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--linea);padding-top:12px">
   <div class="fila"><h2 style="font-size:16px">Revisión de ${esc(p.archivo || 'tu archivo')}</h2></div>
   <div style="display:flex;gap:6px;flex-wrap:wrap">${p.salonesNuevos.length ? chip(p.salonesNuevos.length + ' grupos nuevos', 'ok') : ''}${n(p.grupos, 'nueva') ? chip(n(p.grupos, 'nueva') + ' materias nuevas', 'ok') : ''}${p.grupos.filter(g => g.cambia).length ? chip(p.grupos.filter(g => g.cambia).length + ' materias cambian de profesor o aula', 'aviso') : ''}${p.profesNuevos.length ? chip(p.profesNuevos.length + ' profesores nuevos', 'ok') : ''}
    ${n(p.alumnos, 'nuevo') ? chip(n(p.alumnos, 'nuevo') + ' alumnos nuevos', 'ok') : ''}${n(p.alumnos, 'inscribir') ? chip(n(p.alumnos, 'inscribir') + ' alumnos se asignan a grupo', 'ok') : ''}${n(p.alumnos, 'mover') ? chip(n(p.alumnos, 'mover') + ' alumnos cambian de grupo', 'aviso') : ''}${sinCambio ? chip(sinCambio + ' sin cambios') : ''}${p.avisos.length ? chip(p.avisos.length + ' por revisar', 'mal') : ''}</div>
   ${p.avisos.length ? `<div class="lista">${p.avisos.slice(0, 20).map(a => `<div class="it" style="padding:6px 0"><span class="chip mal">Revisar</span><div class="t"><span style="color:var(--tinta)">${esc(a)}</span></div></div>`).join('')}</div>` : ''}
   ${p.profesNuevos.length ? `<div><b style="font-size:13px">Profesores que se darán de alta</b><div style="font-size:13px;color:var(--gris)">${p.profesNuevos.map(x => esc(x.nombre)).join(', ')} (su cuenta para entrar se crea aparte)</div></div>` : ''}
   ${p.alumnos.some(a => a.accion === 'mover') ? `<div><b style="font-size:13px">Cambios de grupo</b><div class="lista">${p.alumnos.filter(a => a.accion === 'mover').slice(0, 30).map(a => `<div class="it" style="padding:6px 0"><div class="t"><b style="font-size:14px">${esc(a.ya.nombre)}</b><span>${esc(a.actual.nombre)} → ${esc(a.salon)}</span></div></div>`).join('')}</div></div>` : ''}
   <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="gimpok">Importar</button><button class="btn sec" id="gimpno">Cancelar</button><span id="gimpmsg" style="font-size:13px;color:var(--gris);align-self:center"></span></div></div>`;
}
async function importar(p, btn) {
  btn.disabled = true; const msg = t => { const el = document.getElementById('gimpmsg'); if (el) el.textContent = t; };
  try {
    let d = await datosGrupos(); const profId = {};
    msg('Dando de alta profesores…');
    for (const x of p.profesNuevos) { const [r] = await db().insertar('personas', [{rol: 'profesor', nivel: x.nivel, nombre: x.nombre, grado: x.materia}]); profId[normal(x.nombre)] = r.id; }
    msg('Guardando grupos y materias…');
    for (const g of p.grupos) {
      const prof = g.profId || profId[normal(g.profesor)] || null, fila = {nombre: g.nombre, nivel: g.nivel, materia: g.materia, aula: g.aula, ...(g.horario.length ? {horario: g.horario} : {}), ...(prof ? {profesor_id: prof} : {})};
      if (g.existe) await db().actualizar('grupos', fila, {id: g.existe.id}); else await db().insertar('grupos', [{id: idNuevo(d, g.nombre, g.materia), horario: [], ...fila}]);
    }
    d = await datosGrupos(); const salon = (nivel, nombre) => Object.values(d.salones).find(s => s.nivel === nivel && normal(s.nombre) === normal(nombre));
    let k = 0;
    for (const a of p.alumnos) {
      msg(`Alumnos: ${++k} de ${p.alumnos.length}…`); const dest = salon(a.nivel, a.salon); if (!dest) continue;
      let id = a.ya?.id;
      if (!id) { const [r] = await db().insertar('personas', [{rol: 'alumno', nivel: a.nivel, nombre: a.nombre, grado: a.grado, usuario: a.matricula, fecha_nacimiento: a.nacimiento}]); id = r.id; }
      else { const cambios = {estado: 'activo', ...(a.grado ? {grado: a.grado} : {}), ...(a.nacimiento ? {fecha_nacimiento: a.nacimiento} : {})}; await db().actualizar('personas', cambios, {id}); }
      if (a.accion === 'mover') { const viejo = salon(a.nivel, a.actual.nombre); if (viejo) await sacar(id, viejo); }
      if (a.accion !== 'igual') { await inscribir(id, dest, d.ins);
        await db().insertar('movimientos', [{alumno_id: id, tipo: a.accion === 'mover' ? 'cambio_grupo' : 'alta', de_grupo: a.accion === 'mover' ? a.actual.nombre : null, a_grupo: dest.nombre, motivo: 'Importación desde Excel', hecho_por: C.yo.id}]); }
      if (a.tutor) { let papa = d.personas.find(x => x.rol === 'padre' && normal(x.nombre) === normal(a.tutor));
        if (!papa) { [papa] = await db().insertar('personas', [{rol: 'padre', nombre: a.tutor, grado: 'Familia de ' + a.nombre.split(' ')[0]}]); d.personas.push(papa); }
        if (!d.tutores.some(t => t.padre_id === papa.id && t.alumno_id === id)) { await db().insertar('tutores', [{padre_id: papa.id, alumno_id: id, parentesco: a.parentesco}]); d.tutores.push({padre_id: papa.id, alumno_id: id}); } }
    }
    const resumen = `Listo: ${p.grupos.length} materias y ${p.alumnos.length} alumnos revisados.`;
    estGrupos.plan = null; alert(resumen); vAdminGrupos();
  } catch (x) { msg(''); alert('La importación se detuvo: ' + x.message + '\nLo que ya se guardó se queda; puedes volver a subir el archivo y solo se aplicará lo que falte.'); btn.disabled = false; }
}
