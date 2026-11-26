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
function crearDBReal() {
  const filtrar = (q, f) => { for (const [k, v] of Object.entries(f)) { if (Array.isArray(v)) q = q.in(k, v); else if (v && typeof v === 'object' && 'desde' in v) q = q.gte(k, v.desde); else if (v === null) q = q.is(k, null); else q = q.eq(k, v); } return q; };
  const ok = ({data, error}) => { if (error) throw error; return data; };
  return {
    async sesion() { const c = await SB.iniciar(); const {data} = await c.auth.getSession(); return data.session?.user?.id || null; },
    async entrar(u, p) { const c = await SB.iniciar(); const {data, error} = await c.auth.signInWithPassword({email: correoDe(u), password: p}); if (error) throw error; return data.user.id; },
    async salir() { const c = await SB.iniciar(); await c.auth.signOut(); },
    async leer(t, f = {}, o = {}) { if (Object.values(f).some(v => Array.isArray(v) && !v.length)) return []; const c = await SB.iniciar(); let q = filtrar(c.from(t).select('*'), f); if (o.orden) q = q.order(o.orden, {ascending: !o.desc}); if (o.limite) q = q.limit(o.limite); return ok(await q); },
    async insertar(t, filas) { const c = await SB.iniciar(); return ok(await c.from(t).insert(filas).select()); },
    async upsert(t, filas, conflicto) { const c = await SB.iniciar(); return ok(await c.from(t).upsert(filas, {onConflict: conflicto}).select()); },
    async actualizar(t, cambios, f) { const c = await SB.iniciar(); return ok(await filtrar(c.from(t).update(cambios), f).select()); },
    async borrar(t, f) { const c = await SB.iniciar(); return ok(await filtrar(c.from(t).delete(), f)); },
    async subir(b, ruta, archivo) { const c = await SB.iniciar(); const {error} = await c.storage.from(b).upload(ruta, archivo, {upsert: true, contentType: archivo.type || undefined}); if (error) throw error; },
    async url(b, ruta) { const c = await SB.iniciar(); const {data, error} = await c.storage.from(b).createSignedUrl(ruta, 3600); if (error) throw error; return data.signedUrl; },
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
  return [['c/admin', 'Resumen', 'tray'], ['c/admin/alumnos', 'Alumnos', 'perfil'], ['c/admin/calendario', 'Calendario escolar', 'cal'], ['c/admin/pagos', 'Pagos', 'pagos'], ['c/admin/avisos', 'Avisos', 'msg'], ['c/admin/profesores', 'Profesores', 'lista']];
}
function marcoC(ruta, titulo, html) {
  const yo = C.yo, nav = navDe(yo), clase = {profesor: 'prof', padre: 'padre', admin: 'admin', alumno: ''}[yo.rol];
  const activo = k => k === ruta || (ruta.startsWith('c/g/') && k.startsWith(ruta.split('/').slice(0, 3).join('/') + '/')) || (k === 'c/hijo' && ruta === 'c/hijo');
  const rolTxt = {alumno: `${NIVELES[yo.nivel] || ''} · ${yo.grado || ''}`, padre: yo.grado || 'Familia', profesor: `Profesor · ${NIVELES[yo.nivel] || ''}`, admin: 'Administración'}[yo.rol];
  const inf = yo.rol === 'admin' ? [nav[0], nav[2], nav[3]] : nav.slice(0, 3);
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
    if (yo.rol === 'admin') { if (r === 'c/admin/alumnos') return await vAdminAlumnos(); if (r === 'c/admin/profesores') return await vAdminProfesores(); if (r === 'c/admin/avisos') return await vAdminAvisos(); if (r === 'c/admin/calendario') return await vAdminCalendario(); if (r === 'c/admin/pagos') return await vAdminPagos(); return await vAdmin(); }
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
    const ruta = `${i.dataset.t}/${yo.id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
    try { await db().subir('entregas', ruta, f); await db().upsert('entregas', [{tarea_id: +i.dataset.t, alumno_id: yo.id, archivo_ruta: ruta, archivo_nombre: f.name, entregada_en: new Date().toISOString()}], 'tarea_id,alumno_id'); alert(`Listo: "${f.name}" quedó entregado.`); vAlumnoTareas(); }
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
  return `<div class="burbuja ${m.de === yo.id ? 'mia' : ''}">${m.grupo_id && !m.para ? '<small style="font-weight:700;margin:0 0 2px">Para todo el grupo</small>' : ''}${adj}${m.texto ? esc(m.texto) : ''}<small>${hora(m.creado_en)}</small></div>`;
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
      if (adj) { const ruta2 = `${yo.id}/${Date.now()}-${adj.nombre.replace(/[^\w.\-]+/g, '_')}`; await db().subir('adjuntos', ruta2, adj.blob); Object.assign(fila, {adjunto_ruta: ruta2, adjunto_nombre: adj.nombre, adjunto_tipo: adj.blob.type || ''}); }
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
      <div style="overflow-x:auto"><table><thead><tr><th>Alumno</th><th>Nivel</th><th class="ocultar-movil">Grupo</th><th class="num">Asistencia</th><th class="num ocultar-movil">Cuenta</th></tr></thead><tbody>${ver.map(a => `<tr><td>${esc(a.nombre)}<br><span style="font-size:12px;color:var(--gris)">${esc(a.usuario || '')} · ${esc(a.grado || '')}</span></td><td>${NIVELES[a.nivel] || ''}</td><td class="ocultar-movil">${d.ins.filter(i => i.alumno_id === a.id).map(i => esc(d.grupos.find(g => g.id === i.grupo_id)?.nombre || i.grupo_id)).join(', ')}</td><td class="num">${asis(a.id) ?? '—'}${asis(a.id) != null ? ' %' : ''}</td><td class="num ocultar-movil">${a.auth_id ? '<span class="chip ok">Sí</span>' : '<span class="chip">No</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Nadie coincide.</td></tr>'}</tbody></table></div></section>`;
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
