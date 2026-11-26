-- =====================================================================
-- miescuela.com · Base de datos para Supabase
-- Pégalo completo UNA vez en Supabase → SQL Editor → Run.
-- Si lo vuelves a correr, borra y vuelve a crear todo (incluidas las cuentas de prueba).
-- Todas las personas y datos son FICTICIOS.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Limpieza (para poder correrlo otra vez) ----------
drop table if exists public.pagos, public.calendario, public.historial, public.capturas, public.formas_calificar, public.avisos_leidos, public.avisos,
  public.anotaciones, public.mensajes, public.entregas, public.tareas, public.asistencia,
  public.tutores, public.inscripciones, public.grupos, public.personas cascade;
delete from auth.identities where user_id in (select id from auth.users where email like '%@escuela.test');
delete from auth.users where email like '%@escuela.test';

-- ---------- Tablas ----------
-- Personas: alumnos, profesores, padres y administración. auth_id es su cuenta para entrar (los alumnos de kinder, por ejemplo, no tienen).
create table public.personas (
  id        uuid primary key default gen_random_uuid(),
  auth_id   uuid unique references auth.users(id) on delete set null,
  usuario   text unique,
  rol       text not null check (rol in ('alumno','profesor','padre','admin')),
  nivel     text check (nivel in ('kinder','primaria','secundaria','bachillerato','universidad')),
  nombre    text not null,
  grado     text,
  fecha_nacimiento date,
  creado_en timestamptz not null default now()
);

-- Grupos (o materias) con su profesor y su horario. horario: [{"dia":1..6,"inicio":"08:00","fin":"09:30"}]
create table public.grupos (
  id          text primary key,
  nombre      text not null,
  nivel       text not null check (nivel in ('kinder','primaria','secundaria','bachillerato','universidad')),
  materia     text not null,
  clave       text,
  profesor_id uuid references public.personas(id) on delete set null,
  horario     jsonb not null default '[]',
  aula        text,
  ciclo       text not null default '2026-2027',
  inicio      date not null default date '2026-08-17',
  fin         date not null default date '2026-12-11'
);

create table public.inscripciones (
  grupo_id  text references public.grupos(id) on delete cascade,
  alumno_id uuid references public.personas(id) on delete cascade,
  primary key (grupo_id, alumno_id)
);

-- Papás o tutores. En universidad, solo ven datos si el alumno lo autoriza (autorizado = true).
create table public.tutores (
  padre_id   uuid references public.personas(id) on delete cascade,
  alumno_id  uuid references public.personas(id) on delete cascade,
  parentesco text not null default 'Mamá',
  autorizado boolean not null default true,
  primary key (padre_id, alumno_id)
);

-- Pase de lista: P presente, R retardo, F falta.
create table public.asistencia (
  grupo_id       text references public.grupos(id) on delete cascade,
  fecha          date not null,
  alumno_id      uuid references public.personas(id) on delete cascade,
  estado         char(1) not null check (estado in ('P','R','F')),
  perdonado      boolean not null default false,
  nota           text,
  registrado_por uuid references public.personas(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  primary key (grupo_id, fecha, alumno_id)
);

create table public.tareas (
  id          bigint generated always as identity primary key,
  grupo_id    text not null references public.grupos(id) on delete cascade,
  titulo      text not null,
  descripcion text,
  requisitos  text[] not null default '{}',
  entrega     timestamptz not null,
  periodo     int,
  creada_por  uuid references public.personas(id) on delete set null,
  creada_en   timestamptz not null default now()
);

create table public.entregas (
  tarea_id       bigint references public.tareas(id) on delete cascade,
  alumno_id      uuid references public.personas(id) on delete cascade,
  archivo_ruta   text,
  archivo_nombre text,
  entregada_en   timestamptz not null default now(),
  calificacion   numeric(5,2) check (calificacion between 0 and 100),
  comentario     text,
  calificada_en  timestamptz,
  primary key (tarea_id, alumno_id)
);

-- Mensajes: a una persona (para) o a todo un grupo (grupo_id sin para). Pueden llevar foto, audio o archivo.
create table public.mensajes (
  id             bigint generated always as identity primary key,
  de             uuid not null references public.personas(id) on delete cascade,
  para           uuid references public.personas(id) on delete cascade,
  grupo_id       text references public.grupos(id) on delete cascade,
  texto          text,
  adjunto_ruta   text,
  adjunto_nombre text,
  adjunto_tipo   text,
  tarea_id       bigint references public.tareas(id) on delete cascade,   -- comentario sobre una tarea
  creado_en      timestamptz not null default now(),
  check (para is not null or grupo_id is not null),
  check (coalesce(length(texto),0) > 0 or adjunto_ruta is not null)
);

-- Anotaciones del profesor sobre un alumno (fortalezas, qué reforzar, conducta…).
create table public.anotaciones (
  id             bigint generated always as identity primary key,
  alumno_id      uuid not null references public.personas(id) on delete cascade,
  autor_id       uuid references public.personas(id) on delete set null,
  grupo_id       text references public.grupos(id) on delete set null,
  tipo           text not null default 'general' check (tipo in ('fortaleza','reforzar','conducta','salud','general')),
  texto          text not null,
  visible_padres boolean not null default true,
  creado_en      timestamptz not null default now()
);

-- Avisos de la escuela (nivel vacío = para todos) y quién ya los leyó.
create table public.avisos (
  id        bigint generated always as identity primary key,
  autor_id  uuid references public.personas(id) on delete set null,
  titulo    text not null,
  texto     text not null,
  nivel     text check (nivel in ('kinder','primaria','secundaria','bachillerato','universidad')),
  creado_en timestamptz not null default now()
);
create table public.avisos_leidos (
  aviso_id   bigint references public.avisos(id) on delete cascade,
  persona_id uuid references public.personas(id) on delete cascade,
  leido_en   timestamptz not null default now(),
  primary key (aviso_id, persona_id)
);

-- Forma de calificar de cada grupo (la que eligió el profesor) y calificaciones que él captura (exámenes, participación…).
create table public.formas_calificar (
  grupo_id       text primary key references public.grupos(id) on delete cascade,
  esquema        jsonb not null,
  actualizado_por uuid references public.personas(id) on delete set null,
  actualizado_en timestamptz not null default now()
);
create table public.capturas (
  grupo_id  text references public.grupos(id) on delete cascade,
  alumno_id uuid references public.personas(id) on delete cascade,
  rubro     text not null,
  periodo   int not null default 1,
  valor     numeric(5,2) check (valor between 0 and 100),
  primary key (grupo_id, alumno_id, rubro, periodo)
);

-- Calendario escolar: días sin clase, exámenes, eventos, inicio y fin. nivel vacío = toda la escuela.
create table public.calendario (
  id          bigint generated always as identity primary key,
  nivel       text check (nivel in ('kinder','primaria','secundaria','bachillerato','universidad')),
  fecha       date not null,
  fecha_fin   date,
  tipo        text not null check (tipo in ('sin_clase','examen','evento','junta','inicio','fin')),
  titulo      text not null,
  descripcion text,
  grupo_id    text references public.grupos(id) on delete cascade,   -- con grupo: fecha que pone el profesor (ej. su examen)
  creado_por  uuid references public.personas(id) on delete set null
);

-- Pagos (colegiaturas, inscripción…). recordado_en = cuándo se mandó el último aviso de adeudo.
create table public.pagos (
  id           bigint generated always as identity primary key,
  alumno_id    uuid not null references public.personas(id) on delete cascade,
  concepto     text not null,
  monto        numeric(10,2) not null,
  vence        date not null,
  pagado_en    date,
  recordado_en timestamptz
);

-- Calificaciones de ciclos anteriores (kárdex).
create table public.historial (
  alumno_id    uuid references public.personas(id) on delete cascade,
  ciclo        text not null,
  semestre     int,
  clave        text not null,
  materia      text not null,
  fecha        date,
  calificacion numeric(5,2),
  primary key (alumno_id, ciclo, clave)
);

create index on public.asistencia (alumno_id, fecha);
create index on public.pagos (alumno_id);
create index on public.calendario (fecha);
create index on public.mensajes (para);
create index on public.mensajes (grupo_id);
create index on public.anotaciones (alumno_id);
create index on public.tareas (grupo_id);

-- ---------- Funciones de permiso ----------
create or replace function public.mi_persona() returns uuid language sql stable security definer set search_path = public as $$
  select id from public.personas where auth_id = auth.uid() $$;
create or replace function public.mi_rol() returns text language sql stable security definer set search_path = public as $$
  select rol from public.personas where auth_id = auth.uid() $$;
create or replace function public.es_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'admin' from public.personas where auth_id = auth.uid()), false) $$;
create or replace function public.da_clase(g text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.grupos where id = g and profesor_id = public.mi_persona()) $$;
create or replace function public.esta_inscrito(g text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inscripciones where grupo_id = g and alumno_id = public.mi_persona()) $$;
create or replace function public.es_tutor_de(a uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tutores where padre_id = public.mi_persona() and alumno_id = a and autorizado) $$;
create or replace function public.es_mi_alumno(a uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inscripciones i join public.grupos g on g.id = i.grupo_id where i.alumno_id = a and g.profesor_id = public.mi_persona()) $$;
create or replace function public.ve_alumno(a uuid) returns boolean language sql stable security definer set search_path = public as $$
  select a = public.mi_persona() or public.es_admin() or public.es_tutor_de(a) or public.es_mi_alumno(a) $$;
create or replace function public.ve_grupo(g text) returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin() or public.da_clase(g) or public.esta_inscrito(g)
      or exists (select 1 from public.inscripciones i join public.tutores t on t.alumno_id = i.alumno_id
                 where i.grupo_id = g and t.padre_id = public.mi_persona() and t.autorizado) $$;
-- ¿Puedo escribirle a esta persona? Alumno ↔ sus profesores; papá ↔ profesores de su hijo; profesor ↔ sus alumnos y los papás de ellos; todos ↔ administración.
create or replace function public.puede_escribir_a(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin()
      or exists (select 1 from public.personas where id = p and rol = 'admin')
      or public.es_mi_alumno(p)
      or exists (select 1 from public.tutores t where t.padre_id = p and public.es_mi_alumno(t.alumno_id))
      or exists (select 1 from public.grupos g where g.profesor_id = p and public.ve_grupo(g.id)) $$;

-- ---------- Permisos (RLS): cada quien ve solo lo suyo ----------
alter table public.personas enable row level security;
alter table public.grupos enable row level security;
alter table public.inscripciones enable row level security;
alter table public.tutores enable row level security;
alter table public.asistencia enable row level security;
alter table public.tareas enable row level security;
alter table public.entregas enable row level security;
alter table public.mensajes enable row level security;
alter table public.anotaciones enable row level security;
alter table public.avisos enable row level security;
alter table public.avisos_leidos enable row level security;
alter table public.formas_calificar enable row level security;
alter table public.capturas enable row level security;
alter table public.calendario enable row level security;
alter table public.pagos enable row level security;
alter table public.historial enable row level security;

-- El calendario escolar lo ve toda la comunidad; solo administración lo cambia.
create policy "ver calendario" on public.calendario for select to authenticated using (grupo_id is null or public.ve_grupo(grupo_id));
create policy "admin maneja calendario" on public.calendario for all to authenticated using (public.es_admin()) with check (public.es_admin());
-- El profesor pone las fechas de sus grupos (exámenes, entregas importantes) y las puede quitar.
create policy "profesor pone fechas de su grupo" on public.calendario for insert to authenticated with check (grupo_id is not null and public.da_clase(grupo_id) and creado_por = public.mi_persona());
create policy "profesor quita fechas de su grupo" on public.calendario for delete to authenticated using (grupo_id is not null and public.da_clase(grupo_id));
-- Pagos: el alumno, sus papás (si están autorizados) y administración.
create policy "ver pagos" on public.pagos for select to authenticated using (public.es_admin() or alumno_id = public.mi_persona() or public.es_tutor_de(alumno_id));
create policy "admin maneja pagos" on public.pagos for all to authenticated using (public.es_admin()) with check (public.es_admin());
-- Kárdex: el alumno, sus papás y administración.
create policy "ver historial" on public.historial for select to authenticated using (public.es_admin() or alumno_id = public.mi_persona() or public.es_tutor_de(alumno_id));
create policy "admin maneja historial" on public.historial for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Personas: tú, tus alumnos o hijos, tus profesores, tus compañeros de grupo, los papás de tus alumnos y administración.
create policy "ver personas" on public.personas for select to authenticated using (
  id = public.mi_persona() or public.es_admin() or public.ve_alumno(id) or rol = 'admin'
  or exists (select 1 from public.grupos g where g.profesor_id = personas.id and public.ve_grupo(g.id))
  or exists (select 1 from public.inscripciones i where i.alumno_id = personas.id and public.esta_inscrito(i.grupo_id))
  or exists (select 1 from public.tutores t where t.padre_id = personas.id and public.es_mi_alumno(t.alumno_id)));
create policy "admin da de alta personas" on public.personas for insert to authenticated with check (public.es_admin());
create policy "admin cambia personas" on public.personas for update to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "ver grupos" on public.grupos for select to authenticated using (public.ve_grupo(id));
create policy "admin maneja grupos" on public.grupos for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "ver inscripciones" on public.inscripciones for select to authenticated using (public.ve_grupo(grupo_id));
create policy "admin inscribe" on public.inscripciones for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "ver tutores" on public.tutores for select to authenticated using (padre_id = public.mi_persona() or public.es_admin() or public.es_mi_alumno(alumno_id));
create policy "admin maneja tutores" on public.tutores for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "ver asistencia" on public.asistencia for select to authenticated using (public.da_clase(grupo_id) or public.ve_alumno(alumno_id));
create policy "profesor pasa lista" on public.asistencia for insert to authenticated with check (public.da_clase(grupo_id) or public.es_admin());
create policy "profesor corrige lista" on public.asistencia for update to authenticated using (public.da_clase(grupo_id) or public.es_admin()) with check (public.da_clase(grupo_id) or public.es_admin());

create policy "ver tareas" on public.tareas for select to authenticated using (public.ve_grupo(grupo_id));
create policy "profesor publica tareas" on public.tareas for insert to authenticated with check (public.da_clase(grupo_id));
create policy "profesor cambia tareas" on public.tareas for update to authenticated using (public.da_clase(grupo_id)) with check (public.da_clase(grupo_id));
create policy "profesor borra tareas" on public.tareas for delete to authenticated using (public.da_clase(grupo_id));

create policy "ver entregas" on public.entregas for select to authenticated using (
  public.ve_alumno(alumno_id) and (alumno_id = public.mi_persona() or public.es_admin() or public.es_tutor_de(alumno_id)
    or exists (select 1 from public.tareas t where t.id = tarea_id and public.da_clase(t.grupo_id))));
create policy "alumno entrega" on public.entregas for insert to authenticated with check (
  alumno_id = public.mi_persona() and calificacion is null
  and exists (select 1 from public.tareas t where t.id = tarea_id and public.esta_inscrito(t.grupo_id)));
create policy "alumno cambia su entrega antes de calificar" on public.entregas for update to authenticated
  using (alumno_id = public.mi_persona() and calificacion is null) with check (alumno_id = public.mi_persona() and calificacion is null);
-- En kinder y primaria el maestro registra que el niño entregó (los niños no suben archivos).
create policy "profesor registra entrega" on public.entregas for insert to authenticated with check (
  exists (select 1 from public.tareas t join public.grupos g on g.id = t.grupo_id where t.id = tarea_id and public.da_clase(t.grupo_id) and g.nivel in ('kinder','primaria')));
create policy "profesor quita entrega" on public.entregas for delete to authenticated using (
  exists (select 1 from public.tareas t join public.grupos g on g.id = t.grupo_id where t.id = tarea_id and public.da_clase(t.grupo_id) and g.nivel in ('kinder','primaria')));
create policy "profesor califica" on public.entregas for update to authenticated
  using (exists (select 1 from public.tareas t where t.id = tarea_id and public.da_clase(t.grupo_id)))
  with check (exists (select 1 from public.tareas t where t.id = tarea_id and public.da_clase(t.grupo_id)));

create policy "ver mensajes" on public.mensajes for select to authenticated using (
  de = public.mi_persona() or para = public.mi_persona() or public.es_admin()
  or (para is null and grupo_id is not null and public.ve_grupo(grupo_id)));
-- Alumnos de primaria y secundaria: no hay chat directo con el profesor; solo comentarios dentro de una tarea.
create or replace function public.solo_por_tarea() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'alumno' and nivel in ('primaria','secundaria') from public.personas where auth_id = auth.uid()), false) $$;
create policy "mandar mensajes" on public.mensajes for insert to authenticated with check (
  de = public.mi_persona() and (
    (para is not null and public.puede_escribir_a(para) and (tarea_id is not null or not public.solo_por_tarea()))
    or (para is null and grupo_id is not null and (public.da_clase(grupo_id) or public.es_admin()))));

create policy "ver anotaciones" on public.anotaciones for select to authenticated using (
  public.es_admin() or autor_id = public.mi_persona() or public.es_mi_alumno(alumno_id)
  or (visible_padres and public.es_tutor_de(alumno_id)));
create policy "profesor anota" on public.anotaciones for insert to authenticated with check (
  autor_id = public.mi_persona() and (public.es_mi_alumno(alumno_id) or public.es_admin()));
create policy "autor corrige su anotación" on public.anotaciones for update to authenticated using (autor_id = public.mi_persona()) with check (autor_id = public.mi_persona());
create policy "autor borra su anotación" on public.anotaciones for delete to authenticated using (autor_id = public.mi_persona() or public.es_admin());

create policy "ver avisos" on public.avisos for select to authenticated using (
  nivel is null or public.es_admin() or public.mi_rol() = 'profesor'
  or exists (select 1 from public.personas p where p.id = public.mi_persona() and p.nivel = avisos.nivel)
  or exists (select 1 from public.tutores t join public.personas a on a.id = t.alumno_id where t.padre_id = public.mi_persona() and a.nivel = avisos.nivel));
create policy "admin publica avisos" on public.avisos for insert to authenticated with check (public.es_admin() and autor_id = public.mi_persona());
create policy "admin borra avisos" on public.avisos for delete to authenticated using (public.es_admin());

create policy "ver lecturas" on public.avisos_leidos for select to authenticated using (persona_id = public.mi_persona() or public.es_admin());
create policy "marcar enterado" on public.avisos_leidos for insert to authenticated with check (persona_id = public.mi_persona());

create policy "ver forma de calificar" on public.formas_calificar for select to authenticated using (public.ve_grupo(grupo_id));
create policy "profesor elige forma" on public.formas_calificar for insert to authenticated with check (public.da_clase(grupo_id));
create policy "profesor cambia forma" on public.formas_calificar for update to authenticated using (public.da_clase(grupo_id)) with check (public.da_clase(grupo_id));

create policy "ver capturas" on public.capturas for select to authenticated using (public.da_clase(grupo_id) or public.ve_alumno(alumno_id));
create policy "profesor captura" on public.capturas for insert to authenticated with check (public.da_clase(grupo_id));
create policy "profesor corrige captura" on public.capturas for update to authenticated using (public.da_clase(grupo_id)) with check (public.da_clase(grupo_id));
create policy "profesor borra captura" on public.capturas for delete to authenticated using (public.da_clase(grupo_id));

-- Para que la pantalla de entrada sepa si ya se corrió este archivo (solo devuelve cuántas cuentas hay).
create or replace function public.estado_demo() returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.personas where auth_id is not null $$;
grant usage on schema public to anon;
grant execute on function public.estado_demo() to anon;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on all functions in schema public to authenticated;

-- ---------- Archivos: entregas de tareas y adjuntos de mensajes (privados) ----------
insert into storage.buckets (id, name, public) values ('entregas','entregas',false), ('adjuntos','adjuntos',false) on conflict (id) do nothing;
drop policy if exists "subir mi entrega" on storage.objects;
drop policy if exists "ver entregas permitidas" on storage.objects;
drop policy if exists "reemplazar mi entrega" on storage.objects;
drop policy if exists "subir mis adjuntos" on storage.objects;
drop policy if exists "ver adjuntos de mis mensajes" on storage.objects;
-- Entregas: ruta tarea_id/alumno_id/archivo
create policy "subir mi entrega" on storage.objects for insert to authenticated with check (
  bucket_id = 'entregas' and (storage.foldername(name))[2] = public.mi_persona()::text);
create policy "reemplazar mi entrega" on storage.objects for update to authenticated using (
  bucket_id = 'entregas' and (storage.foldername(name))[2] = public.mi_persona()::text);
create policy "ver entregas permitidas" on storage.objects for select to authenticated using (
  bucket_id = 'entregas' and (
    (storage.foldername(name))[2] = public.mi_persona()::text or public.es_admin()
    or exists (select 1 from public.tareas t where t.id::text = (storage.foldername(name))[1] and public.da_clase(t.grupo_id))
    or public.es_tutor_de(((storage.foldername(name))[2])::uuid)));
-- Adjuntos: ruta persona_id/archivo; los ve quien puede ver el mensaje.
create policy "subir mis adjuntos" on storage.objects for insert to authenticated with check (
  bucket_id = 'adjuntos' and (storage.foldername(name))[1] = public.mi_persona()::text);
create policy "ver adjuntos de mis mensajes" on storage.objects for select to authenticated using (
  bucket_id = 'adjuntos' and ((storage.foldername(name))[1] = public.mi_persona()::text
    or exists (select 1 from public.mensajes m where m.adjunto_ruta = storage.objects.name)));

-- =====================================================================
-- DATOS DE PRUEBA (ficticios). Contraseña de todas las cuentas: Demo2026
-- =====================================================================
create or replace function pg_temp.cuenta(p_usuario text, p_nombre text, p_rol text, p_nivel text, p_grado text) returns uuid
language plpgsql as $$
declare u uuid := gen_random_uuid(); p uuid; correo text := lower(p_usuario) || '@escuela.test';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', correo,
    extensions.crypt('Demo2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre), now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), u, u::text, jsonb_build_object('sub', u::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());
  insert into public.personas (auth_id, usuario, rol, nivel, nombre, grado) values (u, p_usuario, p_rol, p_nivel, p_nombre, p_grado) returning id into p;
  return p;
end $$;

create or replace function pg_temp.alumno_sin_cuenta(p_nombre text, p_nivel text, p_grado text, p_usuario text) returns uuid
language sql as $$ insert into public.personas (usuario, rol, nivel, nombre, grado) values (p_usuario, 'alumno', p_nivel, p_nombre, p_grado) returning id $$;

create or replace function pg_temp.grupo(p_id text, p_nombre text, p_nivel text, p_materia text, p_clave text, p_prof uuid, p_horario text, p_aula text, p_inicio date, p_fin date) returns void
language sql as $$ insert into public.grupos (id, nombre, nivel, materia, clave, profesor_id, horario, aula, inicio, fin) values (p_id, p_nombre, p_nivel, p_materia, p_clave, p_prof, p_horario::jsonb, p_aula, p_inicio, p_fin) $$;
create or replace function pg_temp.profe_sin_cuenta(p_nombre text, p_nivel text, p_materia text) returns uuid
language sql as $$ insert into public.personas (rol, nivel, nombre, grado) values ('profesor', p_nivel, p_nombre, p_materia) returning id $$;
-- Si la fecha cae en fin de semana, se pasa al lunes.
create or replace function pg_temp.habil(d date) returns date language sql as $$ select d + case extract(isodow from d)::int when 6 then 2 when 7 then 1 else 0 end $$;
-- Días de lunes a viernes con el mismo horario
create or replace function pg_temp.lv(dias int[], ini text, fin text) returns text language sql as $$
  select json_agg(json_build_object('dia', d, 'inicio', ini, 'fin', fin))::text from unnest(dias) d $$;

do $$
declare
  -- Pedro Páramo García a lo largo de su vida escolar (mismo alumno, distintas etapas).
  pk uuid; pp uuid; ps uuid; pb uuid; pu uuid;
  mk uuid; ms uuid; mb uuid;
  tk uuid; tp uuid; ts uuid; tb uuid; tu uuid; adm uuid;
  g record; a record; per record; i int; n int; k int; f date; h int; t_id bigint; nombres text[]; apellidos text[];
  ini date := date '2026-08-17'; fin date := date '2026-12-11';
  uini date := date '2026-10-03'; ufin date := date '2026-12-05';
  principal text; tutor uuid; dur int; fecha_t date; titulos text[]; mensual numeric;
begin
  adm := pg_temp.cuenta('admin', 'Lic. Martha Chávez Ortega', 'admin', null, 'Control escolar');

  pk := pg_temp.alumno_sin_cuenta('Pedro Páramo García', 'kinder', '3.º de kinder', 'K-PEDRO');
  pp := pg_temp.cuenta('pedro.primaria', 'Pedro Páramo García', 'alumno', 'primaria', '4.º de primaria');
  ps := pg_temp.cuenta('pedro.secundaria', 'Pedro Páramo García', 'alumno', 'secundaria', '2.º de secundaria');
  pb := pg_temp.cuenta('pedro.bachillerato', 'Pedro Páramo García', 'alumno', 'bachillerato', '3.er semestre de bachillerato');
  pu := pg_temp.cuenta('12345678', 'Pedro Páramo García', 'alumno', 'universidad', '5.º semestre · Lic. en Derecho');
  update public.personas set fecha_nacimiento = case id when pk then date '2021-03-14' when pp then date '2016-03-14' when ps then date '2013-03-14' when pb then date '2010-03-14' when pu then date '2005-03-14' end where id in (pk,pp,ps,pb,pu);

  mk := pg_temp.cuenta('mama.kinder', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (kinder)');
  ms := pg_temp.cuenta('mama.secundaria', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (secundaria)');
  mb := pg_temp.cuenta('mama.bachillerato', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (bachillerato)');
  insert into public.tutores (padre_id, alumno_id, parentesco) values (mk, pk, 'Mamá'), (ms, ps, 'Mamá'), (mb, pb, 'Mamá');

  tk := pg_temp.cuenta('prof.kinder', 'Miss Lupita Herrera', 'profesor', 'kinder', 'Titular de 3.º A');
  tp := pg_temp.cuenta('prof.primaria', 'Mtro. Andrés Villa', 'profesor', 'primaria', 'Titular de 4.º B');
  ts := pg_temp.cuenta('prof.secundaria', 'Mtra. Rocío Salazar', 'profesor', 'secundaria', 'Matemáticas');
  tb := pg_temp.cuenta('prof.bachillerato', 'Mtra. Paty Núñez', 'profesor', 'bachillerato', 'Química');
  tu := pg_temp.cuenta('prof.universidad', 'Lic. Sofía Ramírez', 'profesor', 'universidad', 'Derecho Procesal Penal');

  -- Grupos principales (con profesor con cuenta) y las demás materias de Pedro (profesores sin cuenta).
  perform pg_temp.grupo('K3A', 'Kinder 3.º A', 'kinder', 'Grupo (titular)', 'K3A', tk, pg_temp.lv(array[1,2,3,4,5], '09:00', '13:00'), 'Salón Girasol', ini, fin);
  perform pg_temp.grupo('P4B', 'Primaria 4.º B', 'primaria', 'Grupo (titular)', 'P4B', tp, pg_temp.lv(array[1,2,3,4,5], '08:00', '11:00'), 'Salón 12', ini, fin);
  perform pg_temp.grupo('P4B-ING', 'Primaria 4.º B', 'primaria', 'Inglés', 'P4-ING', pg_temp.profe_sin_cuenta('Miss Karen Soto', 'primaria', 'Inglés'), pg_temp.lv(array[2,4], '11:30', '12:30'), 'Salón 12', ini, fin);
  perform pg_temp.grupo('P4B-EF', 'Primaria 4.º B', 'primaria', 'Educación física', 'P4-EF', pg_temp.profe_sin_cuenta('Coach Raúl Mena', 'primaria', 'Educación física'), pg_temp.lv(array[1,3,5], '11:30', '12:30'), 'Patio', ini, fin);
  perform pg_temp.grupo('S2C', 'Secundaria 2.º C', 'secundaria', 'Matemáticas II', 'MAT-2', ts, pg_temp.lv(array[1,3,5], '07:00', '07:50'), 'Salón 8', ini, fin);
  perform pg_temp.grupo('S2C-ESP', 'Secundaria 2.º C', 'secundaria', 'Español II', 'ESP-2', pg_temp.profe_sin_cuenta('Mtra. Irma Duarte', 'secundaria', 'Español'), pg_temp.lv(array[1,3,5], '07:50', '08:40'), 'Salón 8', ini, fin);
  perform pg_temp.grupo('S2C-CIE', 'Secundaria 2.º C', 'secundaria', 'Ciencias II (Física)', 'CIE-2', pg_temp.profe_sin_cuenta('Mtro. Hugo Rangel', 'secundaria', 'Ciencias'), pg_temp.lv(array[2,4], '07:00', '08:40'), 'Laboratorio 1', ini, fin);
  perform pg_temp.grupo('S2C-ING', 'Secundaria 2.º C', 'secundaria', 'Inglés II', 'ING-2', pg_temp.profe_sin_cuenta('Teacher Ann Blake', 'secundaria', 'Inglés'), pg_temp.lv(array[2,4], '09:00', '09:50'), 'Salón 8', ini, fin);
  perform pg_temp.grupo('B3A', 'Bachillerato 3.º A', 'bachillerato', 'Química III', 'QUI-3', tb, pg_temp.lv(array[2,4], '08:40', '10:20'), 'Laboratorio 2', ini, fin);
  perform pg_temp.grupo('B3A-MAT', 'Bachillerato 3.º A', 'bachillerato', 'Matemáticas III', 'MAT-3', pg_temp.profe_sin_cuenta('Mtro. Raúl Ortega', 'bachillerato', 'Matemáticas'), pg_temp.lv(array[1,3,5], '07:00', '08:40'), 'Salón 21', ini, fin);
  perform pg_temp.grupo('B3A-HIS', 'Bachillerato 3.º A', 'bachillerato', 'Historia de México', 'HIS-3', pg_temp.profe_sin_cuenta('Mtro. Óscar Lara', 'bachillerato', 'Historia'), pg_temp.lv(array[2,4], '07:00', '08:40'), 'Salón 21', ini, fin);
  perform pg_temp.grupo('B3A-ING', 'Bachillerato 3.º A', 'bachillerato', 'Inglés III', 'ING-3', pg_temp.profe_sin_cuenta('Teacher Mark Rivera', 'bachillerato', 'Inglés'), pg_temp.lv(array[1,3], '08:40', '09:30'), 'Salón 21', ini, fin);
  perform pg_temp.grupo('B3A-LIT', 'Bachillerato 3.º A', 'bachillerato', 'Literatura', 'LIT-3', pg_temp.profe_sin_cuenta('Mtra. Elena Castro', 'bachillerato', 'Literatura'), pg_temp.lv(array[5], '08:40', '10:20'), 'Salón 21', ini, fin);
  perform pg_temp.grupo('UA3', 'Grupo A3', 'universidad', 'Derecho Procesal Penal', '21E035', tu, pg_temp.lv(array[6], '11:00', '12:30'), 'Aula 14', uini, ufin);
  perform pg_temp.grupo('UA3-FIS', 'Grupo A3', 'universidad', 'Derecho Fiscal II', '21E032', pg_temp.profe_sin_cuenta('C.P. Jorge Medina', 'universidad', 'Derecho Fiscal'), pg_temp.lv(array[6], '08:00', '09:30'), 'Aula 12', uini, ufin);
  perform pg_temp.grupo('UA3-TIT', 'Grupo A3', 'universidad', 'Títulos de crédito', '21E034', pg_temp.profe_sin_cuenta('Lic. Carmen Ruiz', 'universidad', 'Derecho Mercantil'), pg_temp.lv(array[6], '09:30', '11:00'), 'Aula 9', uini, ufin);

  -- Pedro y 7 compañeros ficticios por nivel; están en todas las materias de su grupo.
  nombres := array['Sofía','Mateo','Valentina','Santiago','Regina','Emiliano','Ximena','Diego','Camila','Leonardo','Renata','Sebastián','Mía','Iker','Natalia','Daniel','Romina','Tomás','Abril','Julián'];
  apellidos := array['Aguilar','Barrera','Castillo','Domínguez','Escobar','Flores','Lara','Morales','Núñez','Ortega','Quintero','Rojas','Torres','Valdez','Zamora','Acosta','Bravo','Cortés','Delgado','Ibarra'];
  for g in select * from (values ('K3A', pk), ('P4B', pp), ('S2C', ps), ('B3A', pb), ('UA3', pu)) v(id, pedro) loop
    insert into public.inscripciones select x.id, g.pedro from public.grupos x where x.id = g.id or x.id like g.id || '-%';
    for i in 1..7 loop
      h := 0;
      insert into public.inscripciones select x.id, nuevo.id from public.grupos x,
        (select pg_temp.alumno_sin_cuenta(
          nombres[1 + (abs(hashtext(g.id || i)) % 20)] || ' ' || apellidos[1 + (abs(hashtext(g.id || i || 'a')) % 20)] || ' ' || apellidos[1 + (abs(hashtext(g.id || i || 'b')) % 20)],
          (select nivel from public.grupos where id = g.id), (select grado from public.personas where id = g.pedro), g.id || '-' || lpad(i::text, 2, '0')) as id) nuevo
        where x.id = g.id or x.id like g.id || '-%';
    end loop;
  end loop;
  update public.personas p set fecha_nacimiento = (select fecha_nacimiento from public.personas where id = case p.nivel when 'kinder' then pk when 'primaria' then pp when 'secundaria' then ps when 'bachillerato' then pb else pu end) + (abs(hashtext(p.id::text)) % 300) where p.rol = 'alumno' and p.fecha_nacimiento is null;
  -- Mamá o papá (sin cuenta) de cada compañero menor de edad, para que control escolar pueda mandarles avisos y recordatorios.
  for a in select p.id, p.nombre from public.personas p where p.rol = 'alumno' and p.nivel <> 'universidad' and p.id not in (pk,pp,ps,pb,pu) loop
    h := abs(hashtext(a.id::text || 'tutor')) % 100;
    insert into public.personas (rol, nombre, grado) values ('padre',
      (case when h < 70 then (array['Laura','Patricia','Claudia','Verónica','Mónica','Adriana','Teresa','Lorena'])[1 + h % 8] else (array['Jorge','Ricardo','Arturo','Fernando','Raúl','Héctor'])[1 + h % 6] end)
      || ' ' || split_part(a.nombre, ' ', 2) || ' ' || (array['Ruiz','Soto','Peña','Vega','Luna','Ríos','Mora','Gil'])[1 + (h / 8) % 8],
      'Familia de ' || split_part(a.nombre, ' ', 1)) returning id into tutor;
    insert into public.tutores (padre_id, alumno_id, parentesco) values (tutor, a.id, case when h < 70 then 'Mamá' else 'Papá' end);
  end loop;

  -- Calendario escolar.
  insert into public.calendario (nivel, fecha, fecha_fin, tipo, titulo, descripcion, creado_por) values
   (null, ini, null, 'inicio', 'Inicio de clases', 'Ciclo 2026-2027, primer semestre', adm),
   ('universidad', date '2026-08-01', null, 'inicio', 'Inicio del semestre 2SEM/2026', 'Bloque 1: 1 de agosto al 26 de septiembre', adm),
   ('universidad', uini, null, 'evento', 'Inicio del bloque 2', 'Bloque 2: 3 de octubre al 5 de diciembre', adm),
   (null, date '2026-09-16', null, 'sin_clase', 'Día de la Independencia', null, adm),
   ('kinder', date '2026-09-25', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('primaria', date '2026-09-25', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('secundaria', date '2026-09-25', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('kinder', date '2026-10-30', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('primaria', date '2026-10-30', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('secundaria', date '2026-10-30', null, 'sin_clase', 'Consejo técnico escolar', null, adm),
   ('universidad', date '2026-10-31', null, 'sin_clase', 'Puente de Día de Muertos', null, adm),
   (null, date '2026-11-02', null, 'sin_clase', 'Día de Muertos', null, adm),
   (null, date '2026-11-16', null, 'sin_clase', 'Día de la Revolución (se recorre al lunes)', null, adm),
   ('kinder', date '2026-11-28', null, 'junta', 'Junta de padres de familia', 'Sábado 9:00 · Salón Girasol', adm),
   ('secundaria', date '2026-11-28', null, 'junta', 'Junta de padres de familia', 'Sábado 10:00 · Auditorio', adm),
   ('bachillerato', date '2026-11-28', null, 'junta', 'Junta de padres de familia', 'Sábado 11:00 · Auditorio', adm),
   ('bachillerato', date '2026-12-07', date '2026-12-11', 'examen', 'Exámenes del tercer parcial', null, adm),
   ('secundaria', date '2026-12-07', date '2026-12-10', 'examen', 'Exámenes del tercer trimestre', null, adm),
   ('universidad', ufin, null, 'examen', 'Exámenes finales del bloque 2', null, adm),
   ('kinder', date '2026-12-11', null, 'evento', 'Festival navideño', 'Viernes 10:00 · Traer el disfraz el día anterior', adm),
   (null, fin, null, 'fin', 'Último día de clases', null, adm),
   (null, date '2026-12-14', date '2027-01-06', 'sin_clase', 'Vacaciones de invierno', 'Regreso el 7 de enero', adm);

  -- Asistencia desde el inicio de cada grupo, en sus días de clase y sin contar los días sin clase.
  for g in select * from public.grupos loop
    for f in select d::date from generate_series(g.inicio, least(g.fin, current_date - 1), interval '1 day') d loop
      continue when not exists (select 1 from jsonb_array_elements(g.horario) x where (x->>'dia')::int = extract(isodow from f));
      continue when exists (select 1 from public.calendario c where c.tipo = 'sin_clase' and (c.nivel is null or c.nivel = g.nivel) and f between c.fecha and coalesce(c.fecha_fin, c.fecha));
      for a in select alumno_id from public.inscripciones where grupo_id = g.id loop
        h := abs(hashtext(g.id || f::text || a.alumno_id::text)) % 100;
        insert into public.asistencia (grupo_id, fecha, alumno_id, estado, registrado_por) values (g.id, f, a.alumno_id,
          case when a.alumno_id in (pk,pp,ps,pb,pu) then (case when h < 4 then 'R' else 'P' end) when h < 5 then 'F' when h < 12 then 'R' else 'P' end, g.profesor_id);
      end loop;
    end loop;
  end loop;

  -- Tareas repartidas en el ciclo: 6 por materia (la última aún abierta). En kinder, actividades sencillas.
  for g in select * from public.grupos loop
    titulos := case g.id
      when 'K3A' then array['Colorear los animales de la granja','Traer una hoja seca del parque','Recortar figuras de colores','Traer una foto de mi familia','Dibujar mi casa','Traer material para el festival']
      when 'P4B' then array['Tablas del 2 al 6','Lectura: "El principito", capítulo 1','Tablas del 7 y del 8','Maqueta del sistema solar','Resumen: los estados de México','Problemas de fracciones']
      when 'S2C' then array['Ejercicios de números enteros','Problemas de proporcionalidad','Ecuaciones lineales','Áreas y perímetros','Proyecto: estadística de mi salón','Repaso para el examen']
      when 'B3A' then array['Cuestionario: enlaces químicos','Reporte de práctica: densidad','Reporte de práctica: reacciones redox','Cuestionario de estequiometría','Investigación: polímeros en la vida diaria','Reporte de práctica: titulación']
      when 'UA3' then array['Cuadro: principios del sistema acusatorio','Análisis de una audiencia','Mapa: sujetos procesales','Caso práctico: medidas cautelares','Cuadro: etapas del proceso penal','Ensayo: etapas del proceso penal']
      else array['Ejercicios 1','Lectura y resumen','Ejercicios 2','Investigación','Ejercicios 3','Proyecto final'] end;
    dur := g.fin - g.inicio;
    for i in 1..6 loop
      fecha_t := case when i = 6 then current_date + 7 else g.inicio + (dur * i / 6) end;
      if i < 6 and fecha_t >= current_date then fecha_t := current_date - (6 - i) * 3; end if;
      insert into public.tareas (grupo_id, titulo, descripcion, requisitos, entrega, creada_por) values (g.id,
        case when g.id like '%-%' then g.materia || ': ' || lower(titulos[i]) else titulos[i] end,
        case when g.id = 'UA3' and i = 6 then 'Explica con tus palabras cada etapa del proceso penal acusatorio en México y para qué sirve.' else 'Indicaciones dadas en clase.' end,
        case when g.id = 'UA3' and i = 6 then array['Extensión de 3 a 5 cuartillas','Etapas: investigación, intermedia y juicio oral','Al menos 3 fuentes citadas en formato APA','Entrega en PDF'] when i = 6 then array['Entrega en PDF o foto legible'] else '{}' end,
        fecha_t + time '23:59', g.profesor_id) returning id into t_id;
      if i < 6 then
        for a in select alumno_id from public.inscripciones where grupo_id = g.id loop
          h := abs(hashtext(t_id::text || a.alumno_id::text)) % 100;
          if a.alumno_id in (pk,pp,ps,pb,pu) or h > 10 then
            insert into public.entregas (tarea_id, alumno_id, archivo_nombre, entregada_en, calificacion, calificada_en, comentario)
            values (t_id, a.alumno_id, case when g.nivel in ('kinder','primaria') then null else 'tarea_' || i || '.pdf' end, fecha_t - 1,
              case when g.nivel = 'kinder' or i = 5 then null when a.alumno_id in (pk,pp,ps,pb,pu) then 88 + (h % 13) else 62 + (h % 39) end,
              case when g.nivel = 'kinder' or i = 5 then null else fecha_t + 2 end,
              case when a.alumno_id in (pk,pp,ps,pb,pu) and i < 5 and g.nivel <> 'kinder' then 'Buen trabajo.' end);
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  -- Forma de calificar (cada nivel divide distinto el periodo) y exámenes / rubros capturados de los periodos que ya terminaron.
  insert into public.formas_calificar (grupo_id, esquema, actualizado_por) values
   ('P4B', '{"nombre":"Primaria","etiqueta":"Bloque","parciales":5,"final":0,"comps":[{"id":"t","nombre":"Tareas","pct":40,"fuente":"trabajos"},{"id":"a","nombre":"Actividades en clase","pct":40,"fuente":"manual"},{"id":"s","nombre":"Asistencia","pct":20,"fuente":"asistencia"}]}', tp),
   ('S2C', '{"nombre":"Secundaria","etiqueta":"Trimestre","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Tareas","pct":30,"fuente":"trabajos"},{"id":"p","nombre":"Proyecto","pct":20,"fuente":"manual"},{"id":"e","nombre":"Examen","pct":50,"fuente":"examen"}]}', ts),
   ('B3A', '{"nombre":"La de dirección","etiqueta":"Parcial","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Trabajos","pct":20,"fuente":"trabajos"},{"id":"a","nombre":"Asistencia","pct":10,"fuente":"asistencia"},{"id":"e","nombre":"Examen","pct":70,"fuente":"examen"}]}', tb),
   ('UA3', '{"nombre":"La de dirección","etiqueta":"Parcial","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Trabajos","pct":20,"fuente":"trabajos"},{"id":"a","nombre":"Asistencia","pct":10,"fuente":"asistencia"},{"id":"e","nombre":"Examen","pct":70,"fuente":"examen"}]}', tu);
  for g in select gr.*, coalesce(fc.esquema, '{"parciales":3,"comps":[{"id":"e","fuente":"examen"}]}'::jsonb) as esq from public.grupos gr left join public.formas_calificar fc on fc.grupo_id = gr.id where gr.nivel <> 'kinder' loop
    k := greatest((g.esq->>'parciales')::int, 1); dur := g.fin - g.inicio;
    for n in 1..k loop
      continue when g.inicio + (dur * n / k) >= current_date;
      for a in select alumno_id from public.inscripciones where grupo_id = g.id loop
        h := abs(hashtext(g.id || n || a.alumno_id::text)) % 100;
        for per in select c->>'id' as id, c->>'fuente' as fuente from jsonb_array_elements(g.esq->'comps') c where c->>'fuente' in ('examen','manual') loop
          insert into public.capturas (grupo_id, alumno_id, rubro, periodo, valor) values (g.id, a.alumno_id,
            case when per.fuente = 'examen' then 'examen' else per.id end, n,
            case when a.alumno_id in (pk,pp,ps,pb,pu) then 86 + (h % 15) else 55 + (h % 46) end);
        end loop;
      end loop;
    end loop;
  end loop;

  -- Kárdex de Pedro en la universidad (semestres anteriores y el bloque 1 ya cerrado).
  insert into public.historial (alumno_id, ciclo, semestre, clave, materia, fecha, calificacion) values
   (pu,'2SEM/2024',1,'21E001','Taller de inteligencia emocional y pensamiento positivo','2024-10-05',100),(pu,'2SEM/2024',1,'21E002','Teoría del Estado','2024-12-14',100),(pu,'2SEM/2024',1,'21E003','Derecho Civil I','2024-10-05',100),(pu,'2SEM/2024',1,'21E004','Administración','2024-10-05',90),(pu,'2SEM/2024',1,'21E005','Historia universal del derecho','2024-12-14',95),(pu,'2SEM/2024',1,'21E006','Introducción al estudio del derecho I','2024-10-05',100),(pu,'2SEM/2024',1,'21E007','Redacción jurídica','2024-12-14',100),
   (pu,'1SEM/2025',2,'21E008','Taller de relaciones humanas','2025-06-11',98),(pu,'1SEM/2025',2,'21E009','Metodología jurídica','2025-04-05',95),(pu,'1SEM/2025',2,'21E010','Derecho Civil II','2025-04-05',100),(pu,'1SEM/2025',2,'21E011','Derecho Constitucional I','2025-04-05',100),(pu,'1SEM/2025',2,'21E012','Medicina legal','2025-04-05',100),(pu,'1SEM/2025',2,'21E013','Introducción al estudio del derecho II','2025-06-11',100),(pu,'1SEM/2025',2,'21E014','Derechos humanos','2025-06-11',100),(pu,'1SEM/2025',2,'21E015','Derecho Administrativo I','2025-06-11',84),
   (pu,'2SEM/2025',3,'21E016','Capitalismo social y desarrollo','2025-09-27',80),(pu,'2SEM/2025',3,'21E017','Derecho Mercantil','2025-12-06',95),(pu,'2SEM/2025',3,'21E018','Derecho Civil III','2025-09-27',100),(pu,'2SEM/2025',3,'21E019','Derecho Constitucional II','2025-09-27',100),(pu,'2SEM/2025',3,'21E020','Derecho Penal I','2025-12-06',100),(pu,'2SEM/2025',3,'21E021','Argumentación jurídica','2025-12-06',90),(pu,'2SEM/2025',3,'21E022','Derecho Administrativo II','2025-09-27',100),
   (pu,'1SEM/2026',4,'21E023','Derecho Financiero','2026-06-06',100),(pu,'1SEM/2026',4,'21E024','Derecho Fiscal I','2026-06-06',90),(pu,'1SEM/2026',4,'21E025','Derecho Civil IV','2026-03-21',90),(pu,'1SEM/2026',4,'21E026','Contratos mercantiles','2026-03-21',100),(pu,'1SEM/2026',4,'21E027','Derecho Penal II','2026-06-06',100),(pu,'1SEM/2026',4,'21E028','Derecho a la información','2026-03-21',100),(pu,'1SEM/2026',4,'21E029','Derecho del Trabajo I','2026-03-21',95),(pu,'1SEM/2026',4,'21E030','Medios alternativos de solución de controversias','2026-06-06',100),
   (pu,'2SEM/2026',5,'21E031','Derecho Municipal','2026-09-26',100),(pu,'2SEM/2026',5,'21E033','Derecho Civil V','2026-09-26',100),(pu,'2SEM/2026',5,'21E036','Derecho Notarial','2026-09-26',70),(pu,'2SEM/2026',5,'21E037','Derecho del Trabajo II','2026-09-26',100);

  -- Colegiaturas de agosto a diciembre. Algunas familias deben noviembre (incluida la mamá de Pedro en secundaria).
  for a in select p.id, p.nivel from public.personas p where p.rol = 'alumno' loop
    mensual := case a.nivel when 'kinder' then 3200 when 'primaria' then 3800 when 'secundaria' then 4200 when 'bachillerato' then 4600 else 5200 end;
    insert into public.pagos (alumno_id, concepto, monto, vence) values (a.id, 'Inscripción', mensual, date '2026-08-10');
    for n in 8..12 loop
      insert into public.pagos (alumno_id, concepto, monto, vence) values (a.id, 'Colegiatura ' || (array['agosto','septiembre','octubre','noviembre','diciembre'])[n - 7], mensual, make_date(2026, n, 10));
    end loop;
    h := abs(hashtext(a.id::text || 'pago')) % 100;
    update public.pagos set pagado_en = vence - 3 where alumno_id = a.id and vence < current_date
      and not ((a.id = ps or (a.id not in (pk,pp,pb,pu) and h < 25)) and concepto = 'Colegiatura noviembre');
  end loop;

  -- Anotaciones de los profesores sobre Pedro en cada etapa.
  insert into public.anotaciones (alumno_id, autor_id, grupo_id, tipo, texto, visible_padres, creado_en) values
   (pk, tk, 'K3A', 'fortaleza', 'Reconoce los números del 1 al 20 y le encanta contar cuentos al grupo.', true, now() - interval '20 days'),
   (pk, tk, 'K3A', 'reforzar', 'Le cuesta compartir los materiales; lo estamos trabajando con juegos en equipo.', true, now() - interval '9 days'),
   (pk, tk, 'K3A', 'reforzar', 'Practicar en casa el trazo de las letras de su nombre.', true, now() - interval '3 days'),
   (pp, tp, 'P4B', 'fortaleza', 'Excelente comprensión lectora; lee por gusto en el recreo.', true, now() - interval '15 days'),
   (pp, tp, 'P4B', 'reforzar', 'Reforzar las tablas del 7 y del 8.', true, now() - interval '6 days'),
   (ps, ts, 'S2C', 'conducta', 'Se distrae con el celular en clase. Hablé con él y mejoró.', true, now() - interval '10 days'),
   (ps, ts, 'S2C', 'fortaleza', 'Muy participativo en los problemas en el pizarrón.', true, now() - interval '4 days'),
   (pb, tb, 'B3A', 'reforzar', 'Necesita repasar estequiometría antes del examen.', true, now() - interval '8 days'),
   (pb, tb, 'B3A', 'general', 'Comentario interno: proponerlo para la feria de ciencias.', false, now() - interval '2 days');

  -- Avisos de la escuela.
  insert into public.avisos (autor_id, titulo, texto, nivel, creado_en) values
   (adm, 'Salida temprano', 'El viernes la salida será a las 12:00 por junta de consejo técnico.', null, now() - interval '1 day'),
   (adm, 'Festival navideño', 'El festival de kinder será el 11 de diciembre a las 10:00. Traer el disfraz el día anterior.', 'kinder', now() - interval '3 days'),
   (adm, 'Exámenes del tercer parcial', 'Del 7 al 11 de diciembre. Revisen el calendario de cada materia.', 'bachillerato', now() - interval '2 days');

  -- Fechas que ponen los profesores en sus grupos.
  insert into public.calendario (nivel, fecha, tipo, titulo, descripcion, grupo_id, creado_por) values
   ('primaria', pg_temp.habil(current_date + 5), 'examen', 'Examen de fracciones', 'Traer regla y lápiz', 'P4B', tp),
   ('secundaria', pg_temp.habil(current_date + 3), 'examen', 'Examen de ecuaciones lineales', 'Temas 4 y 5 del cuaderno', 'S2C', ts),
   ('bachillerato', pg_temp.habil(current_date + 6), 'examen', 'Examen de estequiometría', 'Se permite calculadora; traer tabla periódica', 'B3A', tb),
   ('universidad', date '2026-12-05', 'examen', 'Examen final: etapas del proceso penal', 'Aula 14 · 11:00', 'UA3', tu);

  -- Mensajes de ejemplo.
  insert into public.mensajes (de, para, grupo_id, texto, creado_en) values
   (tu, null, 'UA3', 'Buen día, grupo. Ya quedó publicado el ensayo de etapas del proceso penal. Cualquier duda, escríbanme por aquí.', now() - interval '3 days'),
   (tk, mk, null, 'Buenas tardes, mamá de Pedro. Hoy estuvo muy contento en la clase de música.', now() - interval '2 days'),
   (tb, mb, null, 'Buenas tardes. Pedro va muy bien; solo le recomiendo repasar estequiometría antes del examen.', now() - interval '2 days'),
   (mb, tb, null, 'Gracias, maestra. ¿Hay asesorías de Química antes del examen?', now() - interval '1 day'),
   (tp, null, 'P4B', 'Niños: recuerden que el examen de fracciones es la próxima semana. Repasen los ejercicios del cuaderno.', now() - interval '1 day'),
   (ts, null, 'S2C', 'Recuerden que ya está activa la tarea "Repaso para el examen". La pueden entregar hasta el jueves.', now() - interval '20 hours'),
   (tb, null, 'B3A', 'Grupo: el examen de estequiometría incluye balanceo. Mañana resolvemos dudas en clase.', now() - interval '5 hours');
  insert into public.mensajes (de, para, texto, tarea_id, creado_en)
   select ps, ts, 'Maestra, ¿el repaso se entrega en hojas blancas o en el cuaderno?', t.id, now() - interval '6 hours' from public.tareas t where t.grupo_id = 'S2C' order by t.entrega desc limit 1;
  insert into public.mensajes (de, para, texto, tarea_id, creado_en)
   select ts, ps, 'En hojas blancas, Pedro, con tu nombre arriba.', t.id, now() - interval '4 hours' from public.tareas t where t.grupo_id = 'S2C' order by t.entrega desc limit 1;
end $$;

-- Que la API de Supabase vea de inmediato las tablas nuevas (calendario, pagos, historial…).
notify pgrst, 'reload schema';
