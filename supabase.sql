-- =====================================================================
-- miescuela.com · Base de datos para Supabase
-- Pégalo completo UNA vez en Supabase → SQL Editor → Run.
-- Si lo vuelves a correr, borra y vuelve a crear todo (incluidas las cuentas de prueba).
-- Todas las personas y datos son FICTICIOS.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Limpieza (para poder correrlo otra vez) ----------
drop table if exists public.capturas, public.formas_calificar, public.avisos_leidos, public.avisos,
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
  ciclo       text not null default '2026-2027'
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

create index on public.asistencia (alumno_id, fecha);
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
create policy "mandar mensajes" on public.mensajes for insert to authenticated with check (
  de = public.mi_persona() and (
    (para is not null and public.puede_escribir_a(para))
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

do $$
declare
  -- Pedro Páramo García a lo largo de su vida escolar (mismo alumno, distintas etapas).
  pk uuid; pp uuid; ps uuid; pb uuid; pu uuid;
  mk uuid; ms uuid; mb uuid;
  tk uuid; tp uuid; ts uuid; tb uuid; tu uuid; adm uuid;
  g record; a record; i int; f date; h int; t_id bigint; nombres text[]; apellidos text[];
begin
  adm := pg_temp.cuenta('admin', 'Lic. Martha Chávez Ortega', 'admin', null, 'Control escolar');

  pk := pg_temp.alumno_sin_cuenta('Pedro Páramo García', 'kinder', '3.º de kinder', 'K-PEDRO');
  pp := pg_temp.cuenta('pedro.primaria', 'Pedro Páramo García', 'alumno', 'primaria', '4.º de primaria');
  ps := pg_temp.cuenta('pedro.secundaria', 'Pedro Páramo García', 'alumno', 'secundaria', '2.º de secundaria');
  pb := pg_temp.cuenta('pedro.bachillerato', 'Pedro Páramo García', 'alumno', 'bachillerato', '3.er semestre de bachillerato');
  pu := pg_temp.cuenta('12345678', 'Pedro Páramo García', 'alumno', 'universidad', '5.º semestre · Lic. en Derecho');

  mk := pg_temp.cuenta('mama.kinder', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (kinder)');
  ms := pg_temp.cuenta('mama.secundaria', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (secundaria)');
  mb := pg_temp.cuenta('mama.bachillerato', 'Gabriela García Ruiz', 'padre', null, 'Mamá de Pedro (bachillerato)');
  insert into public.tutores (padre_id, alumno_id, parentesco) values (mk, pk, 'Mamá'), (ms, ps, 'Mamá'), (mb, pb, 'Mamá');

  tk := pg_temp.cuenta('prof.kinder', 'Miss Lupita Herrera', 'profesor', 'kinder', 'Titular de 3.º A');
  tp := pg_temp.cuenta('prof.primaria', 'Mtro. Andrés Villa', 'profesor', 'primaria', 'Titular de 4.º B');
  ts := pg_temp.cuenta('prof.secundaria', 'Mtra. Rocío Salazar', 'profesor', 'secundaria', 'Matemáticas');
  tb := pg_temp.cuenta('prof.bachillerato', 'Mtra. Paty Núñez', 'profesor', 'bachillerato', 'Química');
  tu := pg_temp.cuenta('prof.universidad', 'Lic. Sofía Ramírez', 'profesor', 'universidad', 'Derecho Procesal Penal');

  insert into public.grupos (id, nombre, nivel, materia, clave, profesor_id, horario, aula) values
   ('K3A', 'Kinder 3.º A', 'kinder', 'Grupo (titular)', null, tk, '[{"dia":1,"inicio":"09:00","fin":"13:00"},{"dia":2,"inicio":"09:00","fin":"13:00"},{"dia":3,"inicio":"09:00","fin":"13:00"},{"dia":4,"inicio":"09:00","fin":"13:00"},{"dia":5,"inicio":"09:00","fin":"13:00"}]', 'Salón Girasol'),
   ('P4B', 'Primaria 4.º B', 'primaria', 'Grupo (titular)', null, tp, '[{"dia":1,"inicio":"08:00","fin":"13:30"},{"dia":2,"inicio":"08:00","fin":"13:30"},{"dia":3,"inicio":"08:00","fin":"13:30"},{"dia":4,"inicio":"08:00","fin":"13:30"},{"dia":5,"inicio":"08:00","fin":"13:30"}]', 'Salón 12'),
   ('S2C', 'Secundaria 2.º C', 'secundaria', 'Matemáticas II', 'MAT-2', ts, '[{"dia":1,"inicio":"07:00","fin":"07:50"},{"dia":3,"inicio":"07:00","fin":"07:50"},{"dia":5,"inicio":"07:50","fin":"08:40"}]', 'Salón 8'),
   ('B3A', 'Bachillerato 3.º A', 'bachillerato', 'Química III', 'QUI-3', tb, '[{"dia":2,"inicio":"08:40","fin":"10:20"},{"dia":4,"inicio":"08:40","fin":"10:20"}]', 'Laboratorio 2'),
   ('UA3', 'Grupo A3', 'universidad', 'Derecho Procesal Penal', '21E035', tu, '[{"dia":6,"inicio":"11:00","fin":"12:30"}]', 'Aula 14');

  insert into public.inscripciones values ('K3A', pk), ('P4B', pp), ('S2C', ps), ('B3A', pb), ('UA3', pu);

  -- Compañeros de grupo ficticios (sin cuenta), 7 por grupo.
  nombres := array['Sofía','Mateo','Valentina','Santiago','Regina','Emiliano','Ximena','Diego','Camila','Leonardo','Renata','Sebastián','Mía','Iker','Natalia','Daniel','Romina','Tomás','Abril','Julián'];
  apellidos := array['Aguilar','Barrera','Castillo','Domínguez','Escobar','Flores','Lara','Morales','Núñez','Ortega','Quintero','Rojas','Torres','Valdez','Zamora','Acosta','Bravo','Cortés','Delgado','Ibarra'];
  for g in select * from public.grupos loop
    for i in 1..7 loop
      insert into public.inscripciones values (g.id, pg_temp.alumno_sin_cuenta(
        nombres[1 + (abs(hashtext(g.id || i)) % 20)] || ' ' || apellidos[1 + (abs(hashtext(g.id || i || 'a')) % 20)] || ' ' || apellidos[1 + (abs(hashtext(g.id || i || 'b')) % 20)],
        g.nivel, (select grado from public.personas where id = (select alumno_id from public.inscripciones where grupo_id = g.id limit 1)),
        g.id || '-' || lpad(i::text, 2, '0')));
    end loop;
  end loop;

  -- Asistencia de las últimas 4 semanas, en los días que hay clase.
  for g in select * from public.grupos loop
    for f in select d::date from generate_series(current_date - 28, current_date - 1, interval '1 day') d loop
      if exists (select 1 from jsonb_array_elements(g.horario) x where (x->>'dia')::int = extract(isodow from f)) then
        for a in select alumno_id from public.inscripciones where grupo_id = g.id loop
          h := abs(hashtext(g.id || f::text || a.alumno_id::text)) % 100;
          insert into public.asistencia (grupo_id, fecha, alumno_id, estado, nota, registrado_por) values (g.id, f, a.alumno_id,
            case when a.alumno_id in (pk,pp,ps,pb,pu) then (case when h < 8 then 'R' else 'P' end) when h < 5 then 'F' when h < 12 then 'R' else 'P' end,
            null, g.profesor_id);
        end loop;
      end if;
    end loop;
  end loop;

  -- Tareas: dos ya calificadas y una por entregar en cada grupo (en kinder, actividades sencillas).
  for g in select * from public.grupos loop
    for i in 1..3 loop
      insert into public.tareas (grupo_id, titulo, descripcion, requisitos, entrega, periodo, creada_por) values (g.id,
        case g.nivel
          when 'kinder' then (array['Colorear los animales de la granja','Traer una foto de mi familia','Recortar figuras de colores'])[i]
          when 'primaria' then (array['Tablas del 7 y del 8','Lectura: "El principito", capítulo 3','Maqueta del sistema solar'])[i]
          when 'secundaria' then (array['Ejercicios de ecuaciones lineales','Problemas de proporcionalidad','Proyecto: estadística de mi salón'])[i]
          when 'bachillerato' then (array['Reporte de práctica: reacciones redox','Cuestionario de estequiometría','Investigación: polímeros en la vida diaria'])[i]
          else (array['Cuadro: etapas del proceso penal','Análisis de una audiencia','Ensayo: etapas del proceso penal'])[i] end,
        'Indicaciones dadas en clase.',
        case when i = 3 then array['Entrega en PDF o foto legible'] else '{}' end,
        (current_date + (case i when 1 then -14 when 2 then -5 else 7 end)) + time '23:59', 1, g.profesor_id) returning id into t_id;
      if i < 3 then
        for a in select alumno_id from public.inscripciones where grupo_id = g.id loop
          h := abs(hashtext(t_id::text || a.alumno_id::text)) % 100;
          if a.alumno_id in (pk,pp,ps,pb,pu) or h > 12 then
            insert into public.entregas (tarea_id, alumno_id, archivo_nombre, entregada_en, calificacion, calificada_en, comentario)
            values (t_id, a.alumno_id, 'tarea_' || i || '.pdf', now() - interval '6 days',
              case when g.nivel = 'kinder' then null when a.alumno_id in (pk,pp,ps,pb,pu) then 90 + (h % 11) else 70 + (h % 31) end,
              case when g.nivel = 'kinder' then null else now() - interval '2 days' end,
              case when a.alumno_id in (pk,pp,ps,pb,pu) then 'Buen trabajo.' end);
          end if;
        end loop;
      end if;
    end loop;
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
   (adm, 'Festival navideño', 'El festival de kinder será el 12 de diciembre a las 10:00. Traer el disfraz el día anterior.', 'kinder', now() - interval '3 days'),
   (adm, 'Exámenes del segundo parcial', 'Del 4 al 10 de diciembre. Revisen el calendario de cada materia.', 'bachillerato', now() - interval '2 days');

  -- Mensajes de ejemplo.
  insert into public.mensajes (de, para, grupo_id, texto, creado_en) values
   (tu, null, 'UA3', 'Buen día, grupo. Ya quedó publicado el ensayo de etapas del proceso penal. Cualquier duda, escríbanme por aquí.', now() - interval '3 days'),
   (tk, mk, null, 'Buenas tardes, mamá de Pedro. Hoy estuvo muy contento en la clase de música.', now() - interval '2 days'),
   (mb, tb, null, 'Maestra, ¿hay asesorías de Química antes del examen?', now() - interval '1 day');

  -- Forma de calificar de cada grupo (cada nivel divide distinto el periodo).
  insert into public.formas_calificar (grupo_id, esquema, actualizado_por) values
   ('P4B', '{"nombre":"Primaria","etiqueta":"Bloque","parciales":5,"final":0,"comps":[{"id":"t","nombre":"Tareas","pct":40,"fuente":"trabajos"},{"id":"a","nombre":"Actividades en clase","pct":40,"fuente":"manual"},{"id":"s","nombre":"Asistencia","pct":20,"fuente":"asistencia"}]}', tp),
   ('S2C', '{"nombre":"Secundaria","etiqueta":"Trimestre","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Tareas","pct":30,"fuente":"trabajos"},{"id":"p","nombre":"Proyecto","pct":20,"fuente":"manual"},{"id":"e","nombre":"Examen","pct":50,"fuente":"examen"}]}', ts),
   ('B3A', '{"nombre":"La de dirección","etiqueta":"Parcial","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Trabajos","pct":20,"fuente":"trabajos"},{"id":"a","nombre":"Asistencia","pct":10,"fuente":"asistencia"},{"id":"e","nombre":"Examen","pct":70,"fuente":"examen"}]}', tb),
   ('UA3', '{"nombre":"La de dirección","etiqueta":"Parcial","parciales":3,"final":0,"comps":[{"id":"t","nombre":"Trabajos","pct":20,"fuente":"trabajos"},{"id":"a","nombre":"Asistencia","pct":10,"fuente":"asistencia"},{"id":"e","nombre":"Examen","pct":70,"fuente":"examen"}]}', tu);
end $$;
