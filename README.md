# miescuela.com

Prototipo de rediseño de un portal escolar. Escuela, personas y datos ficticios.

## Dos modos

- **Demostración sin cuenta** (`#inicio`): todo funciona en el navegador con datos de ejemplo. Incluye las vistas de alumno, profesor (demo) y padres (demo).
- **Con cuentas** (`#entrar`): inicio de sesión real con Supabase. Cada quien entra a lo suyo según su rol y nivel, y la base de datos solo le entrega lo que tiene permitido ver.

## Activar el modo con cuentas

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, pega todo `supabase.sql` y pulsa **Run**. Crea tablas, permisos (RLS), archivos privados y las cuentas de prueba. Se puede volver a correr: borra y vuelve a crear todo.
3. En `config.js`, pon la **Project URL** y la clave **publishable/anon** (Project Settings → API). Nunca la clave secreta.

## Cuentas de prueba (contraseña `Demo2026`)

| Usuario | Quién es |
|---|---|
| `pedro.primaria`, `pedro.secundaria`, `pedro.bachillerato`, `12345678` | Pedro Páramo García en cada etapa (alumno) |
| `mama.kinder`, `mama.secundaria`, `mama.bachillerato` | Su mamá, en cada etapa |
| `prof.kinder`, `prof.primaria`, `prof.secundaria`, `prof.bachillerato`, `prof.universidad` | Un profesor por nivel |
| `admin` | Control escolar |

## Quién ve qué

- **Alumno**: sus clases, asistencia, tareas (sube archivos desde secundaria), avisos y mensajes con sus profesores. En primaria la vista es más sencilla y sin mensajes.
- **Papá o mamá**: asistencia por día, tareas, anotaciones de los maestros (las marcadas como visibles), avisos con "Enterado" y mensajes con los maestros de su hijo. En universidad solo si el alumno lo autoriza.
- **Profesor**: sus grupos con pase de lista, tareas y calificación, anotaciones por alumno y mensajes al grupo o a cada alumno o papá. En kinder y primaria registra él mismo las actividades entregadas.
- **Administración**: resumen de toda la escuela, alumnos por nivel con alta de expedientes, profesores (última lista, pendientes por calificar) y avisos con quién los leyó.
