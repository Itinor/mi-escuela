// =====================================================================
// miescuela.com · Modo con cuentas sobre las pantallas completas
// Carga los datos reales (Supabase) en las mismas estructuras que usa la demostración,
// así el alumno, el profesor y los papás ven las pantallas completas; lo que cambian se guarda en la base.
// Administración sigue en conectado.js.
// =====================================================================
(function () {
'use strict';

// ---------- Utilidades ----------
const L = (t, f, o) => db().leer(t, f, o);
const dIso = s => fTxt(deIso(s));                       // '2026-11-26' → '26/11/2026'
const dTs = ts => fTxt(new Date(ts));
const hTs = ts => { const d = new Date(ts); return hhmm(d.getHours() * 60 + d.getMinutes()); };
const fyh = ts => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} · ${hhmm(d.getHours() * 60 + d.getMinutes())}`; };
const aIso = f => { const [d, m, y] = f.split('/'); return `${y}-${m}-${d}`; };
const vaciar = o => { for (const k of Object.keys(o)) delete o[k]; };
const reemplazar = (arr, nuevos) => arr.splice(0, arr.length, ...nuevos);
const pesos = n => '$' + (+n).toLocaleString('es-MX', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const edad = fn => { if (!fn) return null; const n = deIso(fn), h = new Date(); let e = h.getFullYear() - n.getFullYear(); if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--; return e; };
const claveDe = g => g.clave || g.id;
const materiaDe = g => /^Grupo/.test(g.materia) ? (g.nivel === 'kinder' ? 'Grupo' : 'Clases del titular') : g.materia;
const enRango = (g, d) => deIso(g.inicio) <= d && d <= deIso(g.fin);
const TIPO_EV = {sin_clase: ['Sin clases', 'sin'], examen: ['Exámenes', 'examen'], evento: ['Evento', 'evento'], junta: ['Junta', 'junta'], inicio: ['Inicio', 'inicio'], fin: ['Fin de clases', 'fin']};
const HORARIO_B1_DEMO = HORARIO.bloques[0];             // Bloque 1 de Pedro en la universidad (ya cerrado; sus calificaciones vienen del kárdex)
const titulo = n => /^(Mtro\.|Prof\.|Coach|Dr\.|Teacher Mark)/.test(n) ? 'Profesor' : /^Miss/.test(n) ? 'Maestra' : 'Profesora';

// Fechas de clase de un grupo (según los días de su horario) y días sin clase del calendario escolar.
function fechasGrupo(g) {
  const dias = new Set((g.horario || []).map(h => +h.dia % 7)), o = [];
  for (const d = deIso(g.inicio), f = deIso(g.fin); d <= f; d.setDate(d.getDate() + 1)) if (dias.has(d.getDay())) o.push(fTxt(d));
  return o;
}
function prepararCal(grupos, cal, nivel) {
  vaciar(CAL.inhabiles);
  const gs = new Set(grupos.map(g => g.id)), matDe = id => { const g = grupos.find(x => x.id === id); return g ? materiaDe(g) : ''; };
  const mios = cal.filter(c => c.grupo_id ? gs.has(c.grupo_id) : (!c.nivel || !nivel || c.nivel === nivel));
  for (const c of mios) if (c.tipo === 'sin_clase') for (const d = deIso(c.fecha), f = deIso(c.fecha_fin || c.fecha); d <= f; d.setDate(d.getDate() + 1)) CAL.inhabiles[fTxt(d)] = c.titulo;
  if (grupos.length) { CAL.inicio = dIso(grupos.map(g => g.inicio).sort()[0]); CAL.fin = dIso(grupos.map(g => g.fin).sort().at(-1)); }
  reemplazar(EVENTOS_CAL, mios.map(c => ({id: c.id, f: deIso(c.fecha), fin: deIso(c.fecha_fin || c.fecha), tipo: c.tipo, titulo: c.grupo_id && grupos.length > 1 ? `${matDe(c.grupo_id)}: ${c.titulo}` : c.titulo, desc: c.descripcion || '', nivel: c.nivel, grupo: c.grupo_id || null})).sort((a, b) => a.f - b.f));
}

// Llena las estructuras de la plataforma (alumnos, lista, tareas, exámenes, forma de calificar) para unos grupos.
// soloAlumno: el alumno (o el hijo) del que se cargan sus datos; sin él, todo el grupo (profesor).
async function cargarGrupos(grupos, soloAlumno, nombreAlumno) {
  const gids = grupos.map(g => g.id);
  const filtro = soloAlumno ? {alumno_id: soloAlumno, grupo_id: gids} : {grupo_id: gids};
  const [ins, tareas, asis, formas, capt] = await Promise.all([
    soloAlumno ? Promise.resolve([]) : L('inscripciones', {grupo_id: gids}),
    L('tareas', {grupo_id: gids}, {orden: 'entrega'}),
    L('asistencia', filtro),
    L('formas_calificar', {grupo_id: gids}),
    L('capturas', filtro)]);
  const ents = await L('entregas', soloAlumno ? {alumno_id: soloAlumno, tarea_id: tareas.map(t => t.id)} : {tarea_id: tareas.map(t => t.id)});
  const personas = soloAlumno ? {} : porId(await L('personas', {id: [...new Set(ins.map(i => i.alumno_id))]}));
  for (const g of grupos) {
    const id = g.id;
    REAL.fechas[id] = fechasGrupo(g);
    ALUMNOS_G[id] = soloAlumno ? [[soloAlumno, nombreAlumno]] : ins.filter(i => i.grupo_id === id).map(i => [i.alumno_id, personas[i.alumno_id]?.nombre || 'Alumno']).sort((a, b) => a[1].localeCompare(b[1]));
    ASIST[id] = {}; PERDONADOS[id] = {}; TAREAS_G[id] = []; EXAMENES[id] = {}; MSG_GRUPO[id] = []; MSG_IND[id] = {}; HIST[id] = [];
    delete PONDER[id]; delete MANUAL[id];
    for (const [m] of ALUMNOS_G[id]) EXAMENES[id][m] = {};
  }
  for (const a of asis) {
    if (!ASIST[a.grupo_id]) continue;
    const f = dIso(a.fecha);
    (ASIST[a.grupo_id][f] ??= {})[a.alumno_id] = a.estado;
    if (a.perdonado) (PERDONADOS[a.grupo_id][f] ??= {})[a.alumno_id] = 1;
    if (a.nota || a.perdonado) REAL.asisInfo[`${a.grupo_id}|${f}|${a.alumno_id}`] = {nota: a.nota, perdonado: a.perdonado};
  }
  const porTarea = {};
  for (const t of tareas) {
    const x = {id: t.id, titulo: t.titulo, parcial: null, publicada: dTs(t.creada_en), entrega: dTs(t.entrega), hora: hTs(t.entrega), desc: t.descripcion || 'Sin descripción.', req: t.requisitos || [], entregas: {}};
    porTarea[t.id] = x; TAREAS_G[t.grupo_id]?.push(x);
  }
  for (const e of ents) {
    const t = porTarea[e.tarea_id]; if (!t) continue;
    t.entregas[e.alumno_id] = {archivo: e.archivo_nombre, ruta: e.archivo_ruta, url: !e.archivo_ruta && e.archivo_nombre ? 'ejemplos/trabajo_ejemplo.pdf' : null,
      fecha: fyh(e.entregada_en), calif: e.calificacion == null ? null : +e.calificacion, coment: e.comentario || ''};
  }
  for (const f of formas) {
    const E = {etiqueta: 'Parcial', final: 0, ...f.esquema, comps: (f.esquema.comps || []).map(c => ({...c, pct: +c.pct}))};
    if (firmaEsq(E) !== firmaEsq(DIRECCION)) PONDER[f.grupo_id] = E;
  }
  for (const c of capt) {
    const v = c.valor == null ? null : +c.valor; if (v == null || !EXAMENES[c.grupo_id]) continue;
    if (c.rubro === 'examen') (EXAMENES[c.grupo_id][c.alumno_id] ??= {})[c.periodo] = v;
    else if (c.rubro === 'final') (EXAMENES[c.grupo_id][c.alumno_id] ??= {}).final = v;
    else (((MANUAL[c.grupo_id] ??= {})[c.rubro] ??= {})[c.periodo] ??= {})[c.alumno_id] = v;
  }
  return {personas, ins};
}
const comoGrupoProf = g => ({id: g.id, cl: claveDe(g), nombre: g.nombre, nivel: g.nivel, horario: (g.horario || []).map(h => ({dia: +h.dia, inicio: h.inicio, fin: h.fin})), aula: g.aula || '', i: g.horario?.[0]?.inicio, f: g.horario?.[0]?.fin});
const notaGrupo = (g, m) => calcSemestre(g, m) ?? alMomentoSem(g, m);

// Avisos de la escuela, calendario y pagos (comunes a alumno y papás).
async function cargarComunes(yo, nivel, alumnoId) {
  const [avisos, leidos, pagos] = await Promise.all([
    L('avisos', {}, {orden: 'creado_en', desc: true, limite: 12}),
    L('avisos_leidos', {persona_id: yo.id}),
    alumnoId ? L('pagos', {alumno_id: alumnoId}, {orden: 'vence'}) : Promise.resolve([])]);
  REAL.avisos = avisos.filter(a => !a.nivel || a.nivel === nivel);
  REAL.leidos = new Set(leidos.map(l => l.aviso_id));
  REAL.pagos = pagos;
}

// Lo que un alumno (o el hijo) tiene: materias, horario, tareas y calificaciones.
async function cargarDeAlumno(alumno) {
  const ins = await L('inscripciones', {alumno_id: alumno.id});
  const grupos = await L('grupos', {id: ins.map(i => i.grupo_id)}, {orden: 'id'});
  const [profes, cal] = await Promise.all([L('personas', {id: [...new Set(grupos.map(g => g.profesor_id).filter(Boolean))]}), L('calendario', {}, {orden: 'fecha'})]);
  REAL.grupos = grupos; REAL.profes = porId(profes); REAL.alumnoId = alumno.id;
  vaciar(MAT); grupos.forEach(g => MAT[claveDe(g)] = materiaDe(g));
  prepararCal(grupos, cal, alumno.nivel);
  reemplazar(GRUPOS_PROF, grupos.map(comoGrupoProf));
  await cargarGrupos(grupos, alumno.id, alumno.nombre);
  const uni = alumno.nivel === 'universidad';
  const clases = grupos.flatMap(g => (g.horario || []).map(h => [+h.dia, h.inicio, h.fin, claveDe(g), REAL.profes[g.profesor_id]?.nombre || '', g.aula || '']));
  const actualB = {nombre: uni ? 'Bloque 2' : 'Ciclo 2026-2027', del: CAL.inicio, al: CAL.fin, clases};
  reemplazar(HORARIO.bloques, uni ? [HORARIO_B1_DEMO, actualB] : [actualB]);
  for (const g of grupos) { let F = 0, R = 0; for (const f in ASIST[g.id]) { const e = ASIST[g.id][f][alumno.id]; if (e === 'F') F++; if (e === 'R') R++; } REAL.faltas[claveDe(g)] = {F, R}; }
  const m = alumno.id;
  reemplazar(TAREAS, grupos.flatMap(g => TAREAS_G[g.id].map(t => { const e = t.entregas[m];
    return {id: t.id, cl: claveDe(g), titulo: t.titulo, publicada: t.publicada, entrega: t.entrega, hora: t.hora, desc: t.desc, req: t.req,
      estado: e ? (e.calif != null ? 'calificada' : 'entregada') : 'pendiente', calif: e?.calif ?? null, archivo: e?.archivo || null,
      ruta: e?.ruta || (e?.archivo ? '__ejemplo' : null), comentario: e?.coment || null, grupo: g.id}; })));
  // Materias del ciclo: lo que lleva en cada una (con la forma de calificar de su profesor).
  const actuales = grupos.map(g => { const cerr = periodos(g.id).every(p => yaPaso(p.al)), s = cerr ? calcSemestre(g.id, m) : null, v = s ?? alMomentoSem(g.id, m); return [claveDe(g), MAT[claveDe(g)], s != null ? 'cerrada' : v != null ? 'lleva al momento' : '', v, null]; });
  if (uni) {
    const hist = await L('historial', {alumno_id: m}, {orden: 'fecha'}), ciclos = {};
    for (const h of hist) (ciclos[h.ciclo] ??= {ciclo: h.ciclo, sem: h.semestre, materias: []}).materias.push([h.clave, h.materia, h.fecha ? dIso(h.fecha) : '', h.calificacion == null ? null : +h.calificacion]);
    const lista = Object.values(ciclos).sort((a, b) => a.sem - b.sem), ult = lista.at(-1);
    if (ult && ult.ciclo === '2SEM/2026') { ult.actual = true; ult.materias.push(...actuales); } else lista.push({ciclo: '2SEM/2026', sem: (ult?.sem || 0) + 1, actual: true, materias: actuales});
    reemplazar(CICLOS, lista);
  } else reemplazar(CICLOS, [{ciclo: '2026-2027', sem: 1, actual: true, materias: actuales}]);
  REAL.comentarios = {};
  if (REAL.rol === 'alumno') for (const x of await L('mensajes', {tarea_id: TAREAS.map(t => t.id)}, {orden: 'creado_en'})) (REAL.comentarios[x.tarea_id] ??= []).push(x);
  cerrados = CICLOS.filter(c => !c.actual);
  promGeneral = prom(cerrados.flatMap(c => c.materias.map(x => x[3])));
  actual = CICLOS.find(c => c.actual);
  return grupos;
}

// ---------- Carga por rol ----------
async function cargarAlumno(yo) {
  await cargarDeAlumno(yo);
  await cargarComunes(yo, yo.nivel, yo.id);
  const uni = yo.nivel === 'universidad', mayor = (edad(yo.fecha_nacimiento) ?? 0) >= 18;
  Object.assign(ALUMNO, {nombre: yo.nombre, iniciales: iniciales(yo.nombre), matricula: yo.usuario || ''});
  if (!uni) Object.assign(ALUMNO, {carrera: NIVELES[yo.nivel], turno: 'Matutino', ciclo: '2026-2027', semestre: null, grado: yo.grado});
  REAL.verPagos = mayor;       // menores de edad (aunque estén en universidad): pagos y datos fiscales los ven sus papás
  REAL.chatDirecto = ['bachillerato', 'universidad'].includes(yo.nivel);   // primaria y secundaria: avisos del grupo y comentarios en tareas
  REAL.rutas = ['inicio', 'calificaciones', ...(uni ? ['kardex'] : []), 'horario', 'faltas', 'actividades', 'mensajes', 'calendario', ...(mayor ? ['pagos'] : []), ...(uni ? ['documentos', 'trayectoria'] : []), 'perfil'];
}

async function cargarPadre(yo) {
  const tut = await L('tutores', {padre_id: yo.id});
  if (!tut.length) throw new Error('No hay alumnos ligados a tu cuenta. Pide a control escolar que te vincule.');
  const hijo = (await L('personas', {id: tut[0].alumno_id}))[0];
  REAL.hijo = hijo; REAL.parentesco = tut[0].parentesco;
  const grupos = await cargarDeAlumno(hijo);
  const [notas] = await Promise.all([L('anotaciones', {alumno_id: hijo.id}, {orden: 'creado_en', desc: true}), cargarComunes(yo, hijo.nivel, hijo.id)]);
  REAL.notas = notas;
  const base = grupos.find(g => !g.id.includes('-')) || grupos[0];
  const entrada = grupos.flatMap(g => (g.horario || []).map(h => h.inicio)).sort()[0] || '';
  Object.assign(FAMILIA, {nombre: yo.nombre, iniciales: iniciales(yo.nombre), parentesco: tut[0].parentesco});
  Object.assign(HIJA, {nombre: hijo.nombre, iniciales: iniciales(hijo.nombre), nivel: NIVELES[hijo.nivel], grado: hijo.grado || '', grupo: base?.nombre || '', tutor: REAL.profes[base?.profesor_id]?.nombre || '', entrada});
  const kinder = hijo.nivel === 'kinder';
  reemplazar(RUTAS_PADRES, [['padres', 'Resumen', 'inicio', 'Familia'], ['padres-horario', 'Horario de clases', 'reloj', 'Familia'], ['padres-escuela', kinder ? 'Actividades y notas' : 'Calificaciones y tareas', 'calif', 'Familia'], ['padres-mensajes', 'Mensajes', 'msg', 'Familia'],
    ['padres-calendario', 'Calendario escolar', 'cal', 'Escuela'], ['padres-pagos', 'Colegiaturas', 'pagos', 'Escuela']]);
  REAL.rutas = RUTAS_PADRES.map(r => r[0]);
}

async function cargarProfesor(yo) {
  const [grupos, cal] = await Promise.all([L('grupos', {profesor_id: yo.id}, {orden: 'id'}), L('calendario', {}, {orden: 'fecha'})]);
  REAL.grupos = grupos;
  vaciar(MAT); grupos.forEach(g => MAT[claveDe(g)] = /^Grupo/.test(g.materia) ? (g.nivel === 'kinder' ? 'Grupo de kinder' : 'Titular del grupo') : g.materia);
  prepararCal(grupos, cal, yo.nivel);
  const {personas} = await cargarGrupos(grupos, null);
  REAL.usuarios = Object.fromEntries(Object.values(personas).map(p => [p.id, p.usuario || '']));
  reemplazar(GRUPOS_PROF, grupos.map(comoGrupoProf));
  const ids = [...new Set(Object.values(ALUMNOS_G).flat().map(a => a[0]))];
  const [tut, recibidos, enviados] = await Promise.all([L('tutores', {alumno_id: ids}), L('mensajes', {para: yo.id}), L('mensajes', {de: yo.id})]);
  REAL.padreDe = {}; tut.forEach(t => REAL.padreDe[t.alumno_id] ??= t.padre_id);
  REAL.conCuenta = new Set(Object.values(personas).filter(p => p.auth_id).map(p => p.id));
  // Para los avisos de "mensaje nuevo": el último mensaje de cada hilo con un alumno.
  for (const x of [...recibidos, ...enviados].filter(x => x.para).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en))) {
    const alumno = x.de === yo.id ? x.para : x.de;
    for (const g of grupos) if (ALUMNOS_G[g.id].some(a => a[0] === alumno)) (MSG_IND[g.id][alumno] ??= []).push([x.de === yo.id ? 'prof' : 'alumno', x.texto || '', fyh(x.creado_en), null, null]);
  }
  REAL.comentarios = {};
  for (const x of [...recibidos, ...enviados].filter(x => x.tarea_id).sort((a, b) => new Date(a.creado_en) - new Date(b.creado_en))) (REAL.comentarios[x.tarea_id] ??= []).push(x);
  Object.assign(PROFE, {nombre: yo.nombre, iniciales: iniciales(yo.nombre), cl: claveDe(grupos[0] || {}), grupo: grupos[0]?.id, titulo: titulo(yo.nombre)});
  const t = PROFE.titulo;
  reemplazar(RUTAS_PROF, [['prof-horario', 'Mi horario', 'reloj', t], ['prof-grupos', 'Mis grupos', 'perfil', t], ['prof-calendario', 'Calendario escolar', 'cal', t],
    ...GRUPOS_PROF.map(g => [`prof-g/${g.id}/lista`, `${g.nombre} · ${nomMat(g.cl)}`, 'lista', 'Grupos'])]);
  REAL.rutas = RUTAS_PROF.map(r => r[0]);
}

async function cargarReal(yo) {
  REAL = {persona: yo, rol: yo.rol, nivel: yo.nivel, rutas: [], fechas: {}, faltas: {}, grupos: [], profes: {}, avisos: [], leidos: new Set(), pagos: [], notas: [], asisInfo: {}};
  if (yo.rol === 'alumno') await cargarAlumno(yo);
  else if (yo.rol === 'padre') await cargarPadre(yo);
  else if (yo.rol === 'profesor') await cargarProfesor(yo);
}
const casa = () => ({alumno: 'inicio', padre: 'padres', profesor: 'prof-horario'}[REAL.rol]);

// ---------- Lo que se guarda en la base ----------
Object.assign(PERSISTIR, {
  async lista(g, fecha) {
    const reg = ASIST[g][fecha] || {}, per = PERDONADOS[g][fecha] || {}, ahora = new Date().toISOString();
    const filas = Object.entries(reg).map(([m, estado]) => ({grupo_id: g, fecha: aIso(fecha), alumno_id: m, estado, perdonado: !!per[m], registrado_por: C.yo.id, actualizado_en: ahora}));
    if (filas.length) await db().upsert('asistencia', filas, 'grupo_id,fecha,alumno_id');
  },
  async tarea(g, t) {
    const [d, m, y] = t.entrega.split('/');
    const [fila] = await db().insertar('tareas', [{grupo_id: g, titulo: t.titulo, descripcion: t.desc, requisitos: t.req, entrega: new Date(`${y}-${m}-${d}T${t.hora || '23:59'}`).toISOString(), creada_por: C.yo.id}]);
    t.id = fila.id;
  },
  async registrar(g, t, m) {
    if (t.entregas[m]) { await db().borrar('entregas', {tarea_id: t.id, alumno_id: m}); delete t.entregas[m]; }
    else { await db().insertar('entregas', [{tarea_id: t.id, alumno_id: m, archivo_nombre: null}]); t.entregas[m] = {archivo: null, ruta: null, url: null, fecha: ahoraTxt(), calif: null, coment: ''}; }
  },
  calificar: (g, t, m, e) => db().actualizar('entregas', {calificacion: e.calif, comentario: e.coment || null, calificada_en: new Date().toISOString()}, {tarea_id: t.id, alumno_id: m}),
  async captura(g, c, n, ms) {
    const val = m => c === 'examen' ? EXAMENES[g]?.[m]?.[n] : MANUAL[g]?.[c]?.[n]?.[m];
    const con = ms.filter(m => val(m) != null), sin = ms.filter(m => val(m) == null);
    if (con.length) await db().upsert('capturas', con.map(m => ({grupo_id: g, alumno_id: m, rubro: c, periodo: n, valor: val(m)})), 'grupo_id,alumno_id,rubro,periodo');
    for (const m of sin) await db().borrar('capturas', {grupo_id: g, alumno_id: m, rubro: c, periodo: n});
  },
  forma: ids => db().upsert('formas_calificar', ids.map(id => ({grupo_id: id, esquema: PONDER[id] || DIRECCION, actualizado_por: C.yo.id, actualizado_en: new Date().toISOString()})), 'grupo_id'),
  notas(g, gp) { const G = grupoDe(g); return gNotas({id: g, nivel: G.nivel}, ALUMNOS_G[g].map(([id, nombre]) => ({id, nombre})), gp); },
  url: (b, ruta) => !ruta || ruta === '__ejemplo' ? Promise.resolve('ejemplos/trabajo_ejemplo.pdf') : db().url(b, ruta),
  async entregaAlumno(t, f) {
    const {ruta, archivo} = await ARCHIVOS.guardar('entregas', `${t.id}/${C.yo.id}`, f);
    await db().upsert('entregas', [{tarea_id: t.id, alumno_id: C.yo.id, archivo_ruta: ruta, archivo_nombre: archivo.name, entregada_en: new Date().toISOString()}], 'tarea_id,alumno_id');
    t.ruta = ruta;
  }
});

// ---------- Piezas de pantalla ----------
const avisosSinLeer = () => REAL.avisos.filter(a => !REAL.leidos.has(a.id));
const avisosHTML = () => { const av = avisosSinLeer(); return av.length ? `<section class="tarjeta" style="border:2px solid var(--aviso)">${av.map(a => `<div class="fila" style="align-items:flex-start"><div><span class="chip aviso">${a.nivel ? 'Aviso de ' + NIVELES[a.nivel].toLowerCase() : 'Aviso de la escuela'}</span><p style="margin:8px 0 2px"><b>${esc(a.titulo)}.</b> ${esc(a.texto)}</p><span style="font-size:12px;color:var(--gris)">${hora(a.creado_en)}</span></div><button class="btn" data-enterado-r="${a.id}" style="padding:8px 12px;font-size:13px;white-space:nowrap">Enterado</button></div>`).join('')}</section>` : ''; };
const examenesProximos = (dias = 10) => { const h = hoy0(), l = new Date(h); l.setDate(h.getDate() + dias); return EVENTOS_CAL.filter(e => e.tipo === 'examen' && e.fin >= h && e.f <= l); };
const examenesHTML = quien => { const ex = examenesProximos(); if (!ex.length) return '';
  return `<section class="tarjeta" style="border:2px solid var(--aviso)"><div class="fila"><h2>${ex.length > 1 ? 'Exámenes próximos' : 'Examen próximo'}</h2><span class="chip aviso">Recordatorio</span></div><div class="lista">${ex.map(e => { const d = Math.round((e.f - hoy0()) / 864e5);
    return `<div class="it"><span class="chip aviso" style="padding:6px 8px;min-width:58px;justify-content:center">${d <= 0 ? 'Hoy' : d === 1 ? 'Mañana' : 'En ' + d + ' días'}</span><div class="t"><b>${esc(e.titulo)}</b><span>${rangoTxt(e)}${e.desc ? ' · ' + esc(e.desc) : ''}</span></div></div>`; }).join('')}</div>${quien ? `<span style="font-size:12px;color:var(--gris)">${quien}</span>` : ''}</section>`; };
const proximosEventos = n => EVENTOS_CAL.filter(e => e.fin >= hoy0() && !['inicio'].includes(e.tipo)).slice(0, n);
const rangoTxt = e => e.fin > e.f ? `Del ${e.f.getDate()} ${MESES[e.f.getMonth()]} al ${e.fin.getDate()} ${MESES[e.fin.getMonth()]}` : `${DIAS[e.f.getDay() || 7] || 'Domingo'} ${e.f.getDate()} ${MESES[e.f.getMonth()]}`;
const eventoIt = e => `<div class="it"><span class="chip ${e.tipo === 'examen' ? 'aviso' : e.tipo === 'sin_clase' ? '' : 'ok'}" style="padding:6px 8px;min-width:58px;justify-content:center">${e.f.getDate()} ${MESES[e.f.getMonth()]}</span><div class="t"><b>${esc(e.titulo)}</b><span>${TIPO_EV[e.tipo][0]} · ${rangoTxt(e)}${e.desc ? ' · ' + esc(e.desc) : ''}</span></div></div>`;
const eventosHTML = (n, titulo2 = 'Próximos eventos') => { const ev = proximosEventos(n); return `<section class="tarjeta"><div class="fila"><h2>${titulo2}</h2><a href="#${REAL.rol === 'padre' ? 'padres-calendario' : REAL.rol === 'profesor' ? 'prof-calendario' : 'calendario'}" style="font-size:13px;font-weight:600">Calendario</a></div><div class="lista">${ev.map(eventoIt).join('') || `<div class="vacio">${ic('cal')}Sin eventos próximos.</div>`}</div></section>`; };
function adeudo() {
  const h = hoy0(), P = REAL.pagos;
  const venc = P.filter(p => !p.pagado_en && deIso(p.vence) < h), prox = P.filter(p => !p.pagado_en && deIso(p.vence) >= h);
  return {venc, prox, total: venc.reduce((a, p) => a + +p.monto, 0)};
}

// Próxima clase (o la que está en curso) según el horario vigente.
function proximaClase() {
  const b = bloqueActual(), c = clasesDe(b), ahora = new Date(), mins = ahora.getHours() * 60 + ahora.getMinutes();
  for (let k = 0; k < 21; k++) {
    const d = hoy0(); d.setDate(d.getDate() + k);
    if (CAL.inhabiles[fTxt(d)] || d < aFecha(b.del) || d > aFecha(b.al)) continue;
    const delDia = c.filter(x => x.dia === (d.getDay() || 7) && (k > 0 || min(x.f) > mins));
    if (delDia.length) return {x: delDia[0], d, k, enCurso: k === 0 && min(delDia[0].i) <= mins};
  }
  return null;
}
const cuandoTxt = p => p.enCurso ? 'Ahora' : p.k === 0 ? 'Hoy' : p.k === 1 ? 'Mañana' : `${DIAS[p.d.getDay() || 7]} ${fCorta(fTxt(p.d))}`;

// Calificación por periodo de un grupo (para alumno y papás).
function filaCalif(g, m, conProf) {
  const G = REAL.grupos.find(x => x.id === g), E = esq(g), nota = notaGrupo(g, m);
  const chips = periodos(g).map(p => { const c = calcPeriodo(g, m, p.n), v = c.final ?? (c.abierto ? c.alMomento : null);
    return `<span class="chip ${v == null ? '' : v >= CAL.minima ? 'ok' : 'mal'}" style="font-size:12px">${E.parciales ? etq(E) + ' ' + p.n : 'Semestre'}: ${v == null ? (c.abierto ? 'en curso' : '—') : num(v, 0)}${c.abierto && v != null ? '*' : ''}</span>`; }).join('');
  return `<a class="it" href="#" data-detalle="${g}" style="color:inherit;flex-wrap:wrap;align-items:flex-start"><div class="t" style="min-width:180px"><b>${esc(MAT[claveDe(G)])}</b><span>${conProf ? esc(REAL.profes[G.profesor_id]?.nombre || '') + ' · ' : ''}${esc(E.nombre)}</span><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${chips}</div></div><span class="nota ${nota == null ? 'vacia' : ''}" style="color:${colorNota(nota)}">${nota == null ? 'Pendiente' : num(nota, 1)}</span></a>`;
}

// ---------- Alumno ----------
const Vorig = {...V};
V.inicio = () => {
  if (!REAL) return Vorig.inicio();
  const yo = REAL.persona, uni = yo.nivel === 'universidad', nino = yo.nivel === 'primaria';
  const pa = promCiclo(actual), capt = actual.materias.filter(m => m[3] != null).length, fal = actual.materias.reduce((a, m) => a + faltasDe(m[0]), 0);
  const pend = TAREAS.filter(t => t.estado === 'pendiente' && diasPara(t.entrega) >= 0).sort((a, b) => aFecha(a.entrega) - aFecha(b.entrega)), venc = TAREAS.filter(t => t.estado === 'pendiente' && diasPara(t.entrega) < 0);
  const px = proximaClase(), ad = REAL.verPagos ? adeudo() : null, pct2 = ALUMNO.creditos / ALUMNO.creditosTotales * 100;
  return `
  <section class="hero portada" id="portada"><span class="formas" aria-hidden="true"><i></i><i></i><i></i></span><p>${nino ? '¡Hola' : 'Hola'},</p><h2>${esc(yo.nombre.split(' ')[0])}${nino ? '!' : ''}</h2><p>${uni ? `${ALUMNO.carrera} · ${ALUMNO.semestre}.º semestre · ${ALUMNO.turno}` : `${NIVELES[yo.nivel]} · ${esc(yo.grado || '')} · ${esc(REAL.grupos.find(g => !g.id.includes('-'))?.nombre || '')}`}</p><p style="font-size:12px;margin-top:6px">${uni ? 'Matrícula' : 'Usuario'} ${esc(ALUMNO.matricula)}</p></section>
  ${avisosHTML()}
  ${examenesHTML()}
  <div class="rejilla">
   ${uni ? `<a class="tarjeta dato" href="#kardex" style="color:inherit"><small>Promedio general</small><b>${fmt(Math.round(promGeneral * 100) / 100)}</b><span>${cerrados.length} semestres cerrados</span></a>` : ''}
   <a class="tarjeta dato" href="#calificaciones" style="color:inherit"><small>${uni ? 'Este semestre' : 'Promedio del ciclo'}</small><b>${pa == null ? '—' : fmt(Math.round(pa * 10) / 10)}</b><span>${capt} de ${actual.materias.length} materias con calificación</span></a>
   <a class="tarjeta dato" href="#actividades" style="color:inherit"><small>${nino ? 'Tareas por hacer' : 'Tareas por entregar'}</small><b style="color:${venc.length ? 'var(--mal)' : 'inherit'}">${pend.length}</b><span>${venc.length ? `${venc.length} vencida${venc.length > 1 ? 's' : ''} sin entregar` : pend[0] ? 'La próxima: ' + fCorta(pend[0].entrega) : 'Todo al día'}</span></a>
   <a class="tarjeta dato" href="#faltas" style="color:inherit"><small>Faltas</small><b>${fal}</b><span>en ${actual.materias.length} materias</span></a>
   ${ad ? `<a class="tarjeta dato" href="#pagos" style="color:inherit"><small>Pagos</small><b style="font-size:24px;color:${ad.total ? 'var(--mal)' : 'var(--ok)'}">${ad.total ? pesos(ad.total) : 'Al corriente'}</b><span>${ad.total ? ad.venc.map(p => p.concepto).join(', ') + ' vencido' : ad.prox[0] ? `${ad.prox[0].concepto} vence el ${dIso(ad.prox[0].vence)}` : 'Sin adeudos'}</span></a>` : ''}
  </div>
  ${uni ? `<section class="tarjeta"><div class="fila"><h2>Avance de la carrera</h2><span class="chip">${pct2.toFixed(2)} %</span></div><div class="progreso"><i style="width:${pct2}%"></i></div><span style="font-size:13px;color:var(--gris)">${ALUMNO.creditos} de ${ALUMNO.creditosTotales} créditos cursados · plan ${ALUMNO.plan}</span></section>` : ''}
  ${pend.length ? `<section class="tarjeta"><div class="fila"><h2>${nino ? 'Tareas por hacer' : 'Tareas por entregar'}</h2><a href="#actividades" style="font-size:13px;font-weight:600">Ver tareas</a></div><div class="lista">${pend.slice(0, 5).map(t => { const d = diasPara(t.entrega); return `<a class="it" href="#actividades" style="color:inherit"><span class="chip ${d <= 3 ? 'aviso' : ''}" style="padding:6px">${ic('act', 'style="width:16px;height:16px"')}</span><div class="t"><b>${esc(t.titulo)}</b><span>${nomMat(t.cl)} · entrega ${t.entrega}</span></div><span class="chip ${d <= 3 ? 'aviso' : ''}">${d === 0 ? 'Hoy' : d === 1 ? 'Mañana' : d + ' días'}</span></a>`; }).join('')}</div></section>` : ''}
  <section class="tarjeta"><div class="fila"><h2>${px?.enCurso ? 'Clase en curso' : 'Próxima clase'}</h2><a href="#horario" style="font-size:13px;font-weight:600">Ver horario</a></div>
   ${px ? `<div class="lista"><div class="it"><span class="chip ${px.enCurso ? 'ok' : ''}" style="padding:6px">${ic('reloj', 'style="width:16px;height:16px"')}</span><div class="t"><b>${nomMat(px.x.cl)}</b><span>${cuandoTxt(px)} ${px.x.i}–${px.x.f} · ${esc(px.x.aula)} · ${esc(px.x.prof)}</span></div></div></div>` : `<div class="vacio">${ic('cal')}No hay clases próximas en el calendario.</div>`}</section>
  <section class="tarjeta"><div class="fila"><h2>Materias de ${actual.ciclo}</h2><a href="#calificaciones" style="font-size:13px;font-weight:600">Ver todo</a></div><div class="lista">${actual.materias.map(m => itemMateria(m, false)).join('')}</div></section>
  ${eventosHTML(4)}
  <p class="aviso-proto">Prototipo · todas las personas y datos son ficticios</p>`;
};
V.calificaciones = () => {
  if (!REAL) return Vorig.calificaciones();
  const m = REAL.alumnoId, uni = REAL.persona.nivel === 'universidad', cerradasB1 = uni ? actual.materias.filter(x => !REAL.grupos.some(g => claveDe(g) === x[0])) : [];
  return `<section class="tarjeta"><div class="fila"><div><h2>${actual.ciclo}</h2><span style="font-size:13px;color:var(--gris)">${uni ? ALUMNO.semestre + '.º semestre · ordinario' : esc(REAL.persona.grado || '')}</span></div><div style="text-align:right"><small style="font-size:12px;color:var(--gris);font-weight:600">Promedio</small><div class="nota" style="font-size:26px">${fmt(promCiclo(actual) == null ? null : Math.round(promCiclo(actual) * 10) / 10)}</div></div></div>
   <span style="font-size:13px;color:var(--gris)">Toca una materia para ver de dónde sale su calificación (tareas, asistencia, exámenes…). * = periodo en curso.</span>
   <div class="lista">${REAL.grupos.map(g => filaCalif(g.id, m, true)).join('')}</div></section>
  ${cerradasB1.length ? `<section class="tarjeta"><h2>Bloque 1 · ya cerrado</h2><div class="lista">${cerradasB1.map(x => itemMateria(x, false)).join('')}</div></section>` : ''}`;
};
V.mensajes = () => REAL ? '<div id="mc"></div><span id="cc" hidden></span>' : Vorig.mensajes();
V.perfil = () => {
  if (!REAL || REAL.persona.nivel === 'universidad') return Vorig.perfil();
  const yo = REAL.persona, c = (k, v) => `<div class="campo"><small>${k}</small>${esc(String(v ?? '—'))}</div>`;
  return `<div class="rejilla"><section class="tarjeta"><div style="display:flex;gap:14px;align-items:center"><span class="avatar" style="width:56px;height:56px;font-size:18px">${ALUMNO.iniciales}</span><div><h2>${esc(yo.nombre)}</h2><span style="font-size:13px;color:var(--gris)">Usuario ${esc(yo.usuario || '')}</span></div></div>
   ${c('Nivel', NIVELES[yo.nivel])}${c('Grado', yo.grado)}${c('Grupo', REAL.grupos.find(g => !g.id.includes('-'))?.nombre)}${c('Ciclo escolar', '2026-2027')}</section>
   <section class="tarjeta"><h2>Datos personales</h2>${c('Fecha de nacimiento', yo.fecha_nacimiento ? dIso(yo.fecha_nacimiento) : null)}${c('Turno', 'Matutino')}<span style="font-size:13px;color:var(--gris)">Para cambiar tus datos o los de tus papás, acude a control escolar.</span></section></div>`;
};
V.pagos = () => {
  if (!REAL) return Vorig.pagos();
  const ad = adeudo(), P = REAL.pagos, h = hoy0(), padre = REAL.rol === 'padre', quien = padre ? REAL.hijo.nombre.split(' ')[0] : '';
  const fila = p => { const v = deIso(p.vence), vencido = !p.pagado_en && v < h;
    return `<div class="it"><div class="t"><b>${esc(p.concepto)}</b><span>${pesos(p.monto)} · ${p.pagado_en ? 'Pagado el ' + dIso(p.pagado_en) : (vencido ? 'Venció el ' : 'Vence el ') + dIso(p.vence)}</span></div>${p.pagado_en ? `<span class="chip ok">${ic('check', 'style="width:14px;height:14px"')} Pagado</span>` : vencido ? `<span class="chip mal">Vencido</span><button class="btn" data-pagar="${p.id}" style="padding:8px 12px;font-size:13px">Pagar</button>` : `<span class="chip">${ic('reloj', 'style="width:14px;height:14px"')} Por vencer</span>`}</div>`; };
  return `
  <section class="hero" style="background:linear-gradient(135deg,${ad.total ? '#B42318,#7A1710' : '#1F7A4D,#145536'})"><p>${ad.total ? 'Saldo vencido' : 'Saldo pendiente'}${padre ? ' · ' + esc(quien) : ''}</p><h2>${pesos(ad.total)}</h2><p>${ad.total ? `${ad.venc.length} pago${ad.venc.length > 1 ? 's' : ''} vencido${ad.venc.length > 1 ? 's' : ''} · págalo para evitar recargos` : ad.prox[0] ? `Al corriente · ${ad.prox[0].concepto} vence el ${dIso(ad.prox[0].vence)}` : 'Al corriente · sin pagos pendientes'}</p></section>
  <div class="rejilla">
   <section class="tarjeta"><h2>${padre ? 'Colegiaturas de ' + esc(quien) : 'Mis pagos del ciclo'}</h2><div class="lista">${P.map(fila).join('') || '<div class="vacio">Sin pagos registrados.</div>'}</div></section>
   <section class="tarjeta"><h2>Cómo pagar</h2><span style="font-size:14px;color:var(--gris)">En línea con tarjeta, o con la referencia en el banco o en tiendas de conveniencia. El pago se refleja aquí al día siguiente.</span>
    <button class="btn" data-pagar="todo" ${ad.total ? '' : 'disabled style="opacity:.5"'}>Pagar ${ad.total ? pesos(ad.total) : ''} en línea</button>
    <div class="campo"><small>Referencia bancaria</small>${esc((REAL.alumnoId || '').slice(0, 8).toUpperCase())}-2026</div>
    <button class="btn sec" ${ad.total ? 'disabled style="opacity:.5" title="Disponible cuando estés al corriente"' : ''} onclick="alert('Prototipo: aquí se descargaría la carta de no adeudo.')">Carta de no adeudo</button></section>
  </div>
  ${V.fiscales()}`;
};
let mesCal = null;
function mesHTML() {
  const a = mesCal.getFullYear(), m = mesCal.getMonth(), ini = new Date(a, m, 1).getDay(), dias = new Date(a, m + 1, 0).getDate(), hoy = hoy0();
  const porDia = {};
  for (const e of EVENTOS_CAL) for (const d = new Date(e.f); d <= e.fin; d.setDate(d.getDate() + 1)) if (d.getMonth() === m && d.getFullYear() === a) { const k = d.getDate(); if (!porDia[k] || e.tipo === 'examen' || (e.tipo === 'sin_clase' && porDia[k].tipo !== 'examen')) porDia[k] = e; }
  let c = ''; for (const d of ['D', 'L', 'M', 'M', 'J', 'V', 'S']) c += `<b>${d}</b>`;
  for (let i = 0; i < ini; i++) c += '<span class="fuera"></span>';
  for (let d = 1; d <= dias; d++) { const e = porDia[d], esHoy = hoy.getFullYear() === a && hoy.getMonth() === m && hoy.getDate() === d; c += `<span class="${esHoy ? 'hoy' : ''} ${e ? TIPO_EV[e.tipo][1] : ''}" ${e ? `title="${esc(e.titulo)}"` : ''}>${d}</span>`; }
  const delMes = EVENTOS_CAL.filter(e => (e.f.getMonth() === m && e.f.getFullYear() === a) || (e.f < new Date(a, m, 1) && e.fin >= new Date(a, m, 1)));
  const nombre = mesCal.toLocaleDateString('es-MX', {month: 'long', year: 'numeric'});
  return `<div class="fila"><button class="btn sec" data-mes="-1" aria-label="Mes anterior" style="padding:8px 12px">‹</button><h2 style="text-transform:capitalize">${nombre}</h2><button class="btn sec" data-mes="1" aria-label="Mes siguiente" style="padding:8px 12px">›</button></div>
   <div class="cal">${c}</div>
   <div class="leyenda-cal"><span><i style="background:var(--fondo);border:1px solid var(--linea)"></i>Sin clases</span><span><i style="background:var(--avisof)"></i>Exámenes</span><span><i style="background:var(--suave)"></i>Eventos y juntas</span><span><i style="background:var(--marca)"></i>Hoy</span></div>
   <div class="lista">${delMes.map(eventoIt).join('') || `<div class="vacio">${ic('cal')}Sin eventos este mes.</div>`}</div>`;
}
V.calendario = () => {
  if (!REAL) return Vorig.calendario();
  mesCal ??= new Date(hoy0().getFullYear(), hoy0().getMonth(), 1);
  const nivel = REAL.rol === 'padre' ? REAL.hijo.nivel : REAL.persona.nivel;
  return `<section class="tarjeta" id="calm">${mesHTML()}</section>
  <section class="tarjeta"><h2>Lo que viene en el ciclo</h2><span style="font-size:13px;color:var(--gris)">Calendario de ${NIVELES[nivel]?.toLowerCase() || 'la escuela'}: días sin clases, exámenes, juntas y eventos. Lo publica control escolar.</span><div class="lista">${proximosEventos(30).map(eventoIt).join('') || '<div class="vacio">Sin eventos.</div>'}</div></section>`;
};

// En primaria los niños no suben archivos: el maestro marca la entrega en el salón. Tampoco tienen mensajes (los tienen sus papás).
const tarjetaOrig = tarjetaTarea;
tarjetaTarea = t => {
  let h = tarjetaOrig(t);
  if (!REAL || REAL.rol !== 'alumno') return h;
  if (REAL.nivel === 'primaria') {
    h = h.replace(/<label class="btn"[\s\S]*?<\/label>/, '');
    if (t.estado === 'pendiente') h = h.replace('<div class="acc">', '<span class="meta">Entrégala en tu salón; tu maestro la marca aquí.</span><div class="acc">');
  }
  if (!REAL.chatDirecto) h = h.replace(/<a class="btn sec" href="#mensajes"[\s\S]*?<\/a>/, '');
  const cs = REAL.comentarios[t.id] || [], prof = REAL.profes[REAL.grupos.find(g => g.id === t.grupo)?.profesor_id];
  if (!cs.length) return prof ? h.replace(/<\/article>\s*$/, `<details class="coments"><summary>${ic('msg', 'style="width:14px;height:14px;vertical-align:-2px"')} Dejar un comentario a ${esc(prof.nombre)}</summary><form class="escribir" data-coment="${t.id}"><input class="tx" placeholder="Escribe tu duda o comentario…" maxlength="500" aria-label="Comentario sobre la tarea"><button class="btn" type="submit" style="padding:8px 12px;font-size:13px">Enviar</button></form></details></article>`) : h;
  const hilo = `<div class="coments"><b style="font-size:13px">Comentarios con ${esc(prof?.nombre || 'tu maestro')}</b>
    ${cs.map(c => `<div class="burbuja ${c.de === C.yo.id ? 'mia' : ''}" style="max-width:100%">${esc(c.texto || '')}<small>${hora(c.creado_en)}</small></div>`).join('')}
    ${prof ? `<form class="escribir" data-coment="${t.id}"><input class="tx" placeholder="${cs.length ? 'Responder…' : 'Escribe una duda o comentario para tu maestro…'}" maxlength="500" aria-label="Comentario sobre la tarea"><button class="btn" type="submit" style="padding:8px 12px;font-size:13px">Enviar</button></form>` : ''}</div>`;
  return h.replace(/<\/article>\s*$/, hilo + '</article>');
};

// Mensajes con la base (alumno): mismo chat con fotos, audio y notas de voz.
const pmOrig = pintarMensajes;
pintarMensajes = function () {
  if (!REAL) return pmOrig();
  if (!REAL.chatDirecto) return avisosDeClase(document.getElementById('mc'));
  if (chatSel) { const g = REAL.grupos.find(x => claveDe(x) === chatSel); if (g?.profesor_id) chatC = g.profesor_id; chatSel = null; }
  return vMensajes('mensajes', null, document.getElementById('mc'));
};

// Avisos de cada clase: el maestro escribe al grupo; el alumno los lee (las dudas van en los comentarios de cada tarea).
let grupoAvisos = null;
async function avisosDeClase(cont) {
  if (!cont.querySelector('.chat')) cont.innerHTML = `<div class="vacio">${ic('reloj')}Cargando…</div>`;
  const gs = REAL.grupos.filter(g => g.profesor_id), msgs = await L('mensajes', {grupo_id: gs.map(g => g.id), para: null}, {orden: 'creado_en'});
  if (!gs.some(g => g.id === grupoAvisos)) grupoAvisos = innerWidth > 820 ? (gs.find(g => msgs.some(m => m.grupo_id === g.id)) || gs[0])?.id : null;
  const g = gs.find(x => x.id === grupoAvisos), hilo = g ? msgs.filter(m => m.grupo_id === g.id) : [];
  const ult = id => { const m = msgs.filter(x => x.grupo_id === id).at(-1); return m ? esc(previaMsg(m.texto, m.adjunto_nombre ? {nombre: m.adjunto_nombre, blob: {type: m.adjunto_tipo || ''}} : null).slice(0, 34)) : 'Sin avisos'; };
  cont.innerHTML = `<div class="chat ${g ? 'abierto' : ''}"><section class="tarjeta contactos"><h2>Avisos de mis clases</h2><span style="font-size:13px;color:var(--gris)">Lo que tus maestros le escriben a todo el grupo.</span>
    <div class="lista">${gs.map(x => `<div class="it ${x.id === grupoAvisos ? 'activo' : ''}" data-ga="${x.id}"><span class="avatar" style="width:40px;height:40px;font-size:12px">${iniciales(REAL.profes[x.profesor_id]?.nombre || '?')}</span><div class="t"><b>${esc(MAT[claveDe(x)])}</b><span>${esc(REAL.profes[x.profesor_id]?.nombre || '')} · ${ult(x.id)}</span></div></div>`).join('')}</div></section>
   <section class="tarjeta conversacion">${g ? `<div><button class="btn sec solo-movil" id="gatras" style="padding:6px 10px;font-size:13px;margin-bottom:6px">← Clases</button><h2>${esc(MAT[claveDe(g)])}</h2><span style="font-size:13px;color:var(--gris)">${esc(REAL.profes[g.profesor_id]?.nombre || '')} · para todo el grupo</span></div>
    <div class="burbujas" id="gbb">${hilo.length ? (await Promise.all(hilo.map(m => burbujaC(m, C.yo)))).join('') : '<div class="vacio">Tu maestro todavía no manda avisos en esta clase.</div>'}</div>
    <div class="campo" style="font-size:13px">Solo tu maestro escribe aquí. Si tienes una duda sobre una tarea, escríbela en los comentarios de esa tarea. <a href="#actividades" style="font-weight:600">Ir a tareas</a></div>` : `<div class="vacio">${ic('msg')}Elige una clase para ver sus avisos.</div>`}</section></div>`;
  const bb = cont.querySelector('#gbb'); if (bb) bb.scrollTop = bb.scrollHeight;
  cont.onclick = e => { const it = e.target.closest('[data-ga]'); if (it) { grupoAvisos = it.dataset.ga; return avisosDeClase(cont); }
    if (e.target.id === 'gatras') { grupoAvisos = null; cont.querySelector('.chat').classList.remove('abierto'); }
    const a = e.target.closest('[data-adj-url]'); if (a) VISOR.abrir({nombre: a.dataset.n, url: a.dataset.adjUrl}); };
}

// ---------- Profesor ----------
// En Tareas: fechas de examen del grupo (las ve el alumno en su calendario y sus papás) y comentarios de los alumnos en cada tarea.
const ptgOrig = pintarTareasG;
pintarTareasG = function (g) {
  ptgOrig(g);
  if (!REAL || REAL.rol !== 'profesor') return;
  const gp = document.getElementById('gp'), tid = estadoProf.tarea[g];
  if (tid === 'nueva') return;
  if (tid) {
    const cs = REAL.comentarios[tid] || [], porAlumno = {};
    cs.forEach(c => { const a = c.de === C.yo.id ? c.para : c.de; (porAlumno[a] ??= []).push(c); });
    const sec = document.createElement('section'); sec.className = 'tarjeta';
    sec.innerHTML = `<div class="fila"><h2>Comentarios de alumnos</h2><span class="chip">${Object.keys(porAlumno).length}</span></div>${Object.entries(porAlumno).map(([a, l]) => `<div class="coments"><b style="font-size:13px">${esc(nomAlumno(g, a) || 'Alumno')}</b>${l.map(c => `<div class="burbuja ${c.de === C.yo.id ? 'mia' : ''}" style="max-width:100%">${esc(c.texto || '')}<small>${hora(c.creado_en)}</small></div>`).join('')}<form class="escribir" data-coment="${tid}" data-para="${a}"><input class="tx" placeholder="Responder a ${esc((nomAlumno(g, a) || '').split(' ')[0])}…" maxlength="500"><button class="btn" type="submit" style="padding:8px 12px;font-size:13px">Enviar</button></form></div>`).join('') || '<div class="vacio">Nadie ha comentado en esta tarea. Las dudas que dejen los alumnos aparecen aquí.</div>'}`;
    gp.appendChild(sec); return;
  }
  const hoy = hoy0(), ex = EVENTOS_CAL.filter(e => e.grupo === g && e.fin >= hoy);
  const sec = document.createElement('section'); sec.className = 'tarjeta';
  sec.innerHTML = `<div class="fila"><div><h2>Fechas de examen</h2><span style="font-size:13px;color:var(--gris)">Los alumnos y sus papás las ven en su calendario y reciben el recordatorio unos días antes.</span></div><button class="btn sec" id="exnueva" style="padding:9px 14px;font-size:13px">+ Poner fecha</button></div>
   <form id="exf" class="oculto" style="display:flex;flex-direction:column;gap:10px"><div class="form"><label>Fecha<input type="date" id="exd" required min="${aIso(fTxt(hoy))}"></label><label>Qué es<input id="ext" required value="Examen" placeholder="Ej. Examen del bloque 3"></label></div><label>Detalle (opcional)<input id="exx" placeholder="Ej. Temas 4 y 5 · traer calculadora"></label><button class="btn" type="submit">Guardar fecha</button></form>
   <div class="lista">${ex.map(e => `<div class="it"><span class="chip aviso" style="padding:6px 8px;min-width:58px;justify-content:center">${fCorta(fTxt(e.f))}</span><div class="t"><b>${esc(e.titulo)}</b><span>${rangoTxt(e)}${e.desc ? ' · ' + esc(e.desc) : ''}</span></div><button class="btn sec" data-quita-ex="${e.id}" style="padding:6px 10px;font-size:12px">Quitar</button></div>`).join('') || '<span style="font-size:13px;color:var(--gris)">Sin exámenes programados.</span>'}</div>`;
  gp.prepend(sec);
  sec.querySelector('#exnueva').onclick = () => sec.querySelector('#exf').classList.toggle('oculto');
  sec.querySelector('#exf').onsubmit = async e => { e.preventDefault(); const G = REAL.grupos.find(x => x.id === g);
    try { const [c] = await db().insertar('calendario', [{nivel: G.nivel, grupo_id: g, tipo: 'examen', fecha: sec.querySelector('#exd').value, titulo: sec.querySelector('#ext').value.trim(), descripcion: sec.querySelector('#exx').value.trim() || null, creado_por: C.yo.id}]);
      EVENTOS_CAL.push({id: c.id, f: deIso(c.fecha), fin: deIso(c.fecha), tipo: 'examen', titulo: c.titulo, desc: c.descripcion || '', nivel: c.nivel, grupo: g}); EVENTOS_CAL.sort((a, b) => a.f - b.f); pintarTareasG(g); }
    catch (x) { alert('No se pudo guardar: ' + x.message); } };
  sec.onclick = async e => { const q = e.target.closest('[data-quita-ex]'); if (!q || !confirm('¿Quitar esta fecha? Dejará de verse en el calendario de los alumnos.')) return;
    try { await db().borrar('calendario', {id: +q.dataset.quitaEx}); reemplazar(EVENTOS_CAL, EVENTOS_CAL.filter(x => x.id !== +q.dataset.quitaEx)); pintarTareasG(g); } catch (x) { alert('No se pudo quitar: ' + x.message); } };
};

const pmgOrig = pintarMensajesG;
pintarMensajesG = function (g) {
  if (!REAL) return pmgOrig(g);
  const sel = estadoProf.chat[g]; estadoProf.chat[g] = null;
  if (sel === 'grupo') chatC = 'grupo:' + g;
  else if (sel) chatC = REAL.conCuenta.has(sel) ? sel : (REAL.padreDe[sel] || sel);   // si el alumno no tiene cuenta, se le escribe a su mamá o papá
  return vMensajes(`prof-g/${g}/mensajes`, g, document.getElementById('gp'));
};
const ppOrig = pintarProf;
pintarProf = function (r) {
  if (REAL && r === 'prof-calendario') { marco(r, 'Calendario escolar', V.calendario()); document.title = 'Calendario escolar · miescuela.com'; return; }
  return ppOrig(r);
};

// ---------- Papás ----------
function clasesDia(d) {
  const wd = d.getDay() || 7;
  return REAL.grupos.filter(g => enRango(g, d)).flatMap(g => (g.horario || []).filter(x => +x.dia === wd).map(x => ({g, i: x.inicio, f: x.fin}))).sort((a, b) => min(a.i) - min(b.i));
}
function diaPadre(d) {
  const f = fTxt(d), m = REAL.alumnoId, cl = clasesDia(d), sin = CAL.inhabiles[f], futuro = d > hoy0(), esHoy = f === fTxt(hoy0());
  const regs = cl.map(c => ({...c, e: ASIST[c.g.id]?.[f]?.[m] || null, info: REAL.asisInfo[`${c.g.id}|${f}|${m}`]}));
  const llam = REAL.notas.filter(n => n.tipo === 'conducta' && fTxt(new Date(n.creado_en)) === f);
  const con = regs.filter(r => r.e), nF = con.filter(r => r.e === 'F').length, nR = con.filter(r => r.e === 'R').length;
  let est = 'fut', txt = '';
  if (sin) txt = 'Sin clases'; else if (!cl.length) txt = 'Sin clases'; else if (futuro) txt = '';
  else if (!con.length) txt = esHoy ? 'Sin registro aún' : 'Sin registro';
  else if (nF === cl.length) { est = 'mal'; txt = 'Faltó'; }
  else if (nF) { est = 'aviso'; txt = `Faltó a ${nF}`; }
  else if (nR) { est = 'aviso'; txt = 'Retardo'; }
  else { est = 'ok'; txt = 'Asistió'; }
  return {d, f, cl: regs, sin, est, txt, llam, futuro, esHoy, dia: DIAS[d.getDay()] || 'Domingo'};
}
function semanaPadre() {
  const h = hoy0(), lunes = new Date(h); lunes.setDate(h.getDate() - ((h.getDay() + 6) % 7));
  const sab = REAL.grupos.some(g => (g.horario || []).some(x => +x.dia === 6));
  return Array.from({length: sab ? 6 : 5}, (_, i) => { const d = new Date(lunes); d.setDate(lunes.getDate() + i); return diaPadre(d); });
}
function detalleDiaReal(x) {
  if (x.sin) return `<div class="vacio">${ic('cal')}Sin clases: ${esc(x.sin)}.</div>`;
  if (!x.cl.length) return `<div class="vacio">${ic('cal')}No tiene clases este día.</div>`;
  if (x.futuro) return `<div class="vacio">${ic('cal')}El ${x.dia.toLowerCase()} todavía no llega.</div>`;
  const ahora = new Date(), mins = ahora.getHours() * 60 + ahora.getMinutes();
  return `<div class="lista">${x.cl.map(c => {
    const mat = esc(MAT[claveDe(c.g)]), prof = esc(REAL.profes[c.g.profesor_id]?.nombre || '');
    if (x.esHoy && min(c.i) > mins && !c.e) return `<div class="it"><span style="width:46px;font-weight:600">${c.i}</span><div class="t"><b>${mat}</b><span>${prof} · todavía no empieza</span></div><span class="chip">Más tarde</span></div>`;
    return `<div class="it" style="align-items:flex-start"><span style="width:46px;font-weight:600;padding-top:2px">${c.i}</span><div class="t"><b>${mat}</b><span>${prof}${c.info?.nota ? ' · ' + esc(c.info.nota) : ''}${c.info?.perdonado ? ' · retardo perdonado' : ''}</span></div>
     ${c.e ? `<span class="chip ${c.e === 'P' ? 'ok' : c.e === 'R' ? 'aviso' : 'mal'}">${c.e === 'P' ? 'Entró' : c.e === 'R' ? 'Retardo' : 'Falta'}</span>` : '<span class="chip">Sin lista</span>'}</div>`; }).join('')}
   ${x.llam.map(n => `<div class="it" style="align-items:flex-start"><span class="chip mal" style="white-space:nowrap">Llamado de atención</span><div class="t"><b style="font-weight:500">${esc(n.texto)}</b><span>${esc(REAL.profes[n.autor_id]?.nombre || 'Maestro')}</span></div></div>`).join('')}</div>`;
}
function tareasHijo() {
  const m = REAL.alumnoId, h = hoy0();
  return REAL.grupos.flatMap(g => TAREAS_G[g.id].map(t => { const e = t.entregas[m]; return {t, g, e, st: e ? (e.calif != null ? 'calificada' : 'entregada') : aFecha(t.entrega) < h ? 'sin entregar' : 'pendiente'}; }))
    .sort((a, b) => aFecha(b.t.entrega) - aFecha(a.t.entrega));
}
const notaIt = n => `<div class="it" style="align-items:flex-start"><span class="chip ${TIPOS_NOTA[n.tipo][1]}" style="white-space:nowrap">${TIPOS_NOTA[n.tipo][0]}</span><div class="t"><b style="font-weight:500">${esc(n.texto)}</b><span>${esc(REAL.profes[n.autor_id]?.nombre || 'Maestro')} · ${hora(n.creado_en)}</span></div></div>`;
function padresReal() {
  const h = REAL.hijo, kinder = h.nivel === 'kinder', m = REAL.alumnoId, semana = semanaPadre(), hoyD = semana.find(x => x.esHoy), ad = adeudo();
  const ts = tareasHijo(), pend = ts.filter(x => x.st === 'pendiente'), noEnt = ts.filter(x => x.st === 'sin entregar'), promH = kinder ? null : prom2(REAL.grupos.map(g => notaGrupo(g.id, m)));
  const hoyTxt2 = !hoyD || !hoyD.cl.length || hoyD.sin ? {t: 'Hoy no hay clases', s: hoyD?.sin || 'Fin de semana', c: 'inherit'} : hoyD.est === 'ok' ? {t: 'Asistió', s: 'Entró a todas sus clases de hoy', c: 'var(--ok)'} : hoyD.est === 'mal' ? {t: 'No asistió', s: 'Según el pase de lista', c: 'var(--mal)'} : hoyD.est === 'aviso' ? {t: hoyD.txt, s: 'Toca el día abajo para ver el detalle', c: 'var(--aviso)'} : {t: 'Sin registro aún', s: 'El maestro todavía no pasa lista', c: 'inherit'};
  const sel = diaSel != null ? semana[diaSel] : null;
  return `
  <section class="hero portada" id="portada" style="background:linear-gradient(135deg,#0E6E8C,#0A4D63)"><span class="formas" aria-hidden="true"><i></i><i></i><i></i></span><p>${esc(FAMILIA.parentesco)} de</p><h2>${esc(HIJA.nombre)}</h2><p>${HIJA.nivel} · ${esc(HIJA.grado)} · ${esc(HIJA.grupo)}${HIJA.tutor ? ' · ' + (kinder || h.nivel === 'primaria' ? 'Titular: ' : 'Tutor(a): ') + esc(HIJA.tutor) : ''}</p></section>
  ${avisosHTML()}
  ${examenesHTML(`Los pone su maestro en el calendario; ${esc(REAL.hijo.nombre.split(' ')[0])} también los ve en su cuenta.`)}
  ${ad.total ? `<a class="tarjeta" href="#padres-pagos" style="border:2px solid var(--mal);color:inherit"><div class="fila" style="align-items:flex-start"><div><span class="chip mal">Pago vencido</span><p style="margin:8px 0 2px">${ad.venc.map(p => esc(p.concepto)).join(', ')} · <b>${pesos(ad.total)}</b></p><span style="font-size:12px;color:var(--gris)">Venció el ${dIso(ad.venc[0].vence)}. Págalo desde Colegiaturas para evitar recargos.</span></div><span class="btn" style="padding:8px 12px;font-size:13px;white-space:nowrap">Ver pagos</span></div></a>` : ''}
  <div class="rejilla">
   <section class="tarjeta dato"><small>Hoy</small><b style="font-size:24px;color:${hoyTxt2.c}">${hoyTxt2.t}</b><span>${esc(hoyTxt2.s)}</span></section>
   ${kinder ? `<a class="tarjeta dato" href="#padres-escuela" style="color:inherit"><small>Notas de su maestra</small><b>${REAL.notas.length}</b><span>${REAL.notas[0] ? 'La última: ' + fCorta(dTs(REAL.notas[0].creado_en)) : 'Sin notas todavía'}</span></a>`
    : `<a class="tarjeta dato" href="#padres-escuela" style="color:inherit"><small>Promedio del ciclo</small><b style="color:${colorNota(promH)}">${num(promH, 1)}</b><span>${REAL.grupos.length} materias · lo que lleva al momento</span></a>`}
   <a class="tarjeta dato" href="#padres-escuela" style="color:inherit"><small>${kinder ? 'Actividades' : 'Tareas'}</small><b style="font-size:24px;color:${noEnt.length ? 'var(--mal)' : 'inherit'}">${noEnt.length ? noEnt.length + ' sin entregar' : pend.length + ' pendientes'}</b><span>${noEnt.length ? `y ${pend.length} por entregar` : 'Todo al día'}</span></a>
   <a class="tarjeta dato" href="#padres-pagos" style="color:inherit"><small>Colegiatura</small><b style="font-size:24px;color:${ad.total ? 'var(--mal)' : 'var(--ok)'}">${ad.total ? pesos(ad.total) : 'Al corriente'}</b><span>${ad.total ? 'Saldo vencido' : ad.prox[0] ? `${esc(ad.prox[0].concepto)} vence el ${dIso(ad.prox[0].vence)}` : 'Sin pagos pendientes'}</span></a>
  </div>
  <section class="tarjeta"><div class="fila"><h2>Asistencia de esta semana</h2><a href="#padres-horario" class="chip" style="color:inherit">Entrada ${esc(HIJA.entrada)}</a></div>
   <div class="semana-asis" id="sasis" style="grid-template-columns:repeat(${semana.length},1fr)">${semana.map((x, i) => `<button type="button" data-dia="${i}" class="${x.est} ${diaSel === i ? 'sel' : ''}" title="${x.dia}: ${x.txt || 'por venir'}"><b>${x.dia.slice(0, 3)}</b><span>${x.d.getDate()}</span><small>${x.txt}</small>${x.llam.length ? '<em class="punto" style="position:absolute;top:6px;right:6px;min-width:16px;height:16px;font-size:10px;padding:0 4px">!</em>' : ''}</button>`).join('')}</div>
   <span style="font-size:12px;color:var(--gris)">Toca un día para ver clase por clase si entró, si llegó tarde o si hubo un llamado de atención.</span>
   <div id="ddia">${sel ? `<div class="fila" style="margin-top:4px"><h2 style="font-size:15px">${sel.dia} ${fCorta(sel.f)}</h2><button class="btn sec" id="dcerrar2" style="padding:6px 10px;font-size:12px">Cerrar</button></div>${detalleDiaReal(sel)}` : ''}</div></section>
  <div class="rejilla">
   <section class="tarjeta"><div class="fila"><h2>Lo que dicen sus maestros</h2><a href="#padres-escuela" style="font-size:13px;font-weight:600">Ver todo</a></div><div class="lista">${REAL.notas.slice(0, 3).map(notaIt).join('') || '<div class="vacio">Sin anotaciones por ahora.</div>'}</div></section>
   ${eventosHTML(4)}
  </div>
  <section class="tarjeta"><div class="fila"><h2>Avisarme por notificación</h2></div>
   ${[['llegada', 'Cuando su maestro pase lista'], ['falta', 'Si falta o llega tarde'], ['tareas', kinder ? 'Si hay una actividad nueva' : 'Si no entrega una tarea'], ['calif', kinder ? 'Cuando su maestra escriba una nota' : 'Cuando tenga una calificación nueva'], ['avisos', 'Avisos y recordatorios de la escuela']].map(([k, t]) => `<label class="interruptor"><span>${t}</span><input type="checkbox" data-notif="${k}" ${NOTIF_B[k] ? 'checked' : ''}><i></i></label>`).join('')}
   <span style="font-size:12px;color:var(--gris)">Llegan a tu celular desde la plataforma. Sin grupos de WhatsApp.</span></section>
  <p class="aviso-proto">Prototipo · alumno y familia ficticios</p>`;
}
function padresEscuelaReal() {
  const h = REAL.hijo, kinder = h.nivel === 'kinder', m = REAL.alumnoId, ts = tareasHijo();
  const chip = x => x.st === 'calificada' ? `<span class="nota" style="color:${colorNota(x.e.calif)}">${num(x.e.calif)}</span>` : x.st === 'entregada' ? `<span class="chip ok">${kinder ? 'Hecha' : 'Entregada'}</span>` : x.st === 'sin entregar' ? `<span class="chip mal">${kinder ? 'No la hizo' : 'No la entregó'}</span>` : '<span class="chip">Por entregar</span>';
  const tareas = `<section class="tarjeta"><div class="fila"><h2>${kinder ? 'Actividades' : 'Tareas'}</h2><span class="chip">${ts.length}</span></div><div class="lista">${ts.map(x => `<div class="it"><div class="t"><b>${esc(x.t.titulo)}</b><span>${esc(MAT[claveDe(x.g)])} · ${kinder ? 'para el' : 'entrega'} ${x.t.entrega}${x.e?.coment ? ' · “' + esc(x.e.coment) + '”' : ''}</span></div>${chip(x)}</div>`).join('') || '<div class="vacio">Sin tareas.</div>'}</div></section>`;
  const notas = `<section class="tarjeta"><div class="fila"><h2>Lo que dicen sus maestros</h2><span class="chip">${REAL.notas.length}</span></div><div class="lista">${REAL.notas.map(notaIt).join('') || '<div class="vacio">Sin anotaciones por ahora.</div>'}</div></section>`;
  if (kinder) return `<div class="rejilla">${notas}${tareas}</div><span style="font-size:13px;color:var(--gris);text-align:center">En kinder no hay calificaciones numéricas: la maestra registra cómo va con notas y actividades.</span>`;
  return `<section class="tarjeta"><div class="fila"><h2>Calificaciones</h2><span class="chip">${esc(h.grado || '')}</span></div><span style="font-size:13px;color:var(--gris)">Cada materia con la forma de calificar de su maestro. Toca una para ver el detalle. * = periodo en curso.</span>
    <div class="lista">${REAL.grupos.map(g => filaCalif(g.id, m, true)).join('')}</div></section>
   ${tareas}${notas}`;
}
const pPadresOrig = pintarPadres;
pintarPadres = function (r) {
  if (!REAL) return pPadresOrig(r);
  const def = RUTAS_PADRES.find(x => x[0] === r) || RUTAS_PADRES[0], k = def[0];
  if (k === 'padres') {
    marco(k, def[1], padresReal());
    const mn = document.querySelector('main');
    const verDia = i => { diaSel = diaSel === i ? null : i; const y = scrollY; pintarPadres('padres'); scrollTo(0, y); document.querySelectorAll('main > *').forEach(x => x.classList.add('visto')); };
    mn.onclick = e => { const d = e.target.closest('[data-dia]'); if (d) verDia(+d.dataset.dia); if (e.target.id === 'dcerrar2') verDia(diaSel); };
    mn.oncontextmenu = e => { const d = e.target.closest('[data-dia]'); if (d) { e.preventDefault(); if (diaSel !== +d.dataset.dia) verDia(+d.dataset.dia); } };
    mn.onchange = e => { const c = e.target.closest('[data-notif]'); if (c) NOTIF_B[c.dataset.notif] = c.checked; };
  } else if (k === 'padres-horario') {
    const nombre = REAL.hijo.nombre.split(' ')[0];
    marco(k, def[1], `<span style="font-size:14px;color:var(--gris)">Las clases de ${esc(nombre)} y qué maestro da cada una.</span>${V.horario()}
     <section class="tarjeta"><h2>Sus maestros</h2><div class="lista">${REAL.grupos.map(g => `<div class="it"><span class="avatar" style="width:40px;height:40px;font-size:12px;background:#0E6E8C">${iniciales(REAL.profes[g.profesor_id]?.nombre || '?')}</span><div class="t"><b>${esc(REAL.profes[g.profesor_id]?.nombre || 'Por asignar')}</b><span>${esc(MAT[claveDe(g)])} · ${horarioCorto(g)} · ${esc(g.aula || '')}</span></div></div>`).join('')}</div><a class="btn sec" href="#padres-mensajes" style="text-align:center">Escribir a un maestro</a></section>`);
    pintarHorario(bloqueActual().nombre); document.getElementById('hb').onclick = e => { const b = e.target.closest('button'); if (b) pintarHorario(b.dataset.b); };
  } else if (k === 'padres-escuela') marco(k, def[1], padresEscuelaReal());
  else if (k === 'padres-calendario') marco(k, def[1], V.calendario());
  else if (k === 'padres-pagos') marco(k, def[1], V.pagos());
  else { marco(k, def[1], '<div id="mc"></div>'); vMensajes(k, null, document.getElementById('mc')); }
  document.title = def[1] + ' · Familia · miescuela.com';
};

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-coment]'); if (!f || !REAL) return;
  e.preventDefault(); const tx = f.querySelector('.tx'), texto = tx.value.trim(); if (!texto) return;
  const tid = +f.dataset.coment, para = f.dataset.para || REAL.profes[REAL.grupos.find(g => g.id === TAREAS.find(t => t.id === tid)?.grupo)?.profesor_id]?.id;
  if (!para) return; f.querySelector('button').disabled = true;
  try { const [m] = await db().insertar('mensajes', [{de: C.yo.id, para, texto, tarea_id: tid}]); (REAL.comentarios[tid] ??= []).push({...m, creado_en: m.creado_en || new Date().toISOString()});
    if (REAL.rol === 'profesor') { const g = location.hash.split('/')[1]; pintarTareasG(g); }
    else { const y = scrollY; pintarTareas(document.querySelector('#tt .activo')?.dataset.f || 'pendiente'); scrollTo(0, y); }
  } catch (x) { alert('No se pudo enviar: ' + x.message); f.querySelector('button').disabled = false; }
});

// ---------- Clics comunes (avisos, calendario, pagos, detalle de calificación) ----------
document.addEventListener('click', async e => {
  if (!REAL) return;
  const b = e.target.closest('[data-enterado-r]');
  if (b) { b.disabled = true; try { await db().insertar('avisos_leidos', [{aviso_id: +b.dataset.enteradoR, persona_id: C.yo.id}]); REAL.leidos.add(+b.dataset.enteradoR); const y = scrollY; pintar(); scrollTo(0, y); } catch (x) { alert('No se pudo marcar: ' + x.message); b.disabled = false; } return; }
  const mb = e.target.closest('[data-mes]');
  if (mb) { mesCal.setMonth(mesCal.getMonth() + +mb.dataset.mes); document.getElementById('calm').innerHTML = mesHTML(); return; }
  const pg = e.target.closest('[data-pagar]');
  if (pg) { alert('Prototipo: aquí se abriría el pago en línea con tarjeta. Al confirmarse, el pago aparece como pagado y se genera la factura con tus datos fiscales.'); return; }
  const dt = e.target.closest('[data-detalle]');
  if (dt) { e.preventDefault(); detalleAlumno(dt.dataset.detalle, REAL.alumnoId); document.getElementById('dmsg')?.remove(); }
});

// ---------- Entrada, rutas permitidas y salida ----------
window.guardaReal = r => {
  if (!REAL) return r;
  if (REAL.rol === 'profesor') { const p = r.split('/'); return ['prof-horario', 'prof-grupos', 'prof-calendario'].includes(r) || (p[0] === 'prof-g' && grupoDe(p[1])) ? r : 'prof-horario'; }
  return REAL.rutas.includes(r) ? r : casa();
};
function mostrarError(x) {
  document.getElementById('raiz').innerHTML = `<div class="login"><div class="tarjeta" style="max-width:460px;display:flex;flex-direction:column;gap:12px"><h2>Algo falló al abrir tu cuenta</h2>
   <span style="font-size:14px;color:var(--gris)">Mándale este mensaje a quien te ayuda con la plataforma:</span><code style="background:var(--fondo);padding:10px;border-radius:10px;font-size:12px;white-space:pre-wrap">${esc(String(x?.stack || x?.message || x)).slice(0, 600)}</code>
   <a class="btn" href="#" onclick="location.reload();return false" style="text-align:center">Volver a intentar</a><a class="btn sec" href="#salir-c" style="text-align:center">Salir</a></div></div>`;
}
addEventListener('error', e => { if (REAL && !document.querySelector('main')) mostrarError(e.error || e.message); });
function pantallaCarga(yo) {
  document.getElementById('raiz').innerHTML = `<div class="login"><div style="color:#fff;text-align:center;display:flex;flex-direction:column;gap:10px;align-items:center"><div class="logo" style="justify-content:center"><b style="background:#fff;color:var(--marca)">me</b><span>miescuela.com</span></div><span style="opacity:.85">Preparando lo de ${esc(yo.nombre.split(' ')[0])}…</span></div></div>`;
}
let cargaEnCurso = null;
async function entrarReal(yo, r) {
  if (!cargaEnCurso) { pantallaCarga(yo); cargaEnCurso = cargarReal(yo); }
  try { await cargaEnCurso; } catch (x) { cargaEnCurso = null; REAL = null; return vistaEntrar('No se pudo cargar tu información: ' + (x.message || x)); }
  const destino = r && !(r === 'entrar' || r === 'c' || r.startsWith('c/')) ? guardaReal(r) : casa();
  if (location.hash !== '#' + destino) history.replaceState(null, '', '#' + destino);
  try { pintar(); } catch (x) { console.error(x); mostrarError(x); }
}
const pcOrig = pintarConectado;
window.pintarConectado = async r => {
  if (r === 'salir-c' && REAL) { try { await db().salir(); } catch {} history.replaceState(null, '', '#entrar'); location.reload(); return; }
  if (r === 'entrar' || r === 'c' || r.startsWith('c/')) {
    let yo = null; try { yo = await quienSoy(); } catch {}
    if (yo && yo.rol !== 'admin') return entrarReal(yo, '');
  }
  return pcOrig(r);
};
window.arrancar = async () => {
  if (!conCuentas()) return pintar();
  const r = (location.hash || '').slice(1);
  let yo = null; try { yo = await quienSoy(); } catch { return pintar(); }
  if (!yo) return pintar();
  if (yo.rol === 'admin') { if (!(r === 'c' || r.startsWith('c/'))) history.replaceState(null, '', '#c'); return pintar(); }
  return entrarReal(yo, r);
};
})();
