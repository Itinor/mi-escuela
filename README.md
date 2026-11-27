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

Con cuenta se usan las mismas pantallas completas de la demostración, con los datos de la base y ajustadas al nivel.

- **Alumno**: inicio, calificaciones por periodo (con el desglose de cada materia), horario, faltas, tareas, mensajes y calendario escolar. En universidad, además, kárdex, documentos y trayectoria. Ve sus pagos solo si ya cumplió 18 años; los datos fiscales se piden dentro de Pagos. En primaria no sube archivos (su maestro marca la entrega en el salón) y no tiene mensajes.
- **Mensajes del alumno según su nivel**: en primaria y secundaria no hay chat directo con el profesor; ven los avisos que su maestro manda a todo el grupo y dejan sus dudas como comentarios dentro de cada tarea. Desde bachillerato también pueden escribirle directo al profesor. Lo que un niño necesite decirle al maestro lo hace su papá o mamá desde su cuenta.
- **Fechas de examen**: el profesor las pone en Tareas; el alumno y sus papás las ven en el calendario y como recordatorio en su inicio unos días antes.
- **Papá o mamá**: resumen con la asistencia de la semana (clase por clase), horario de clases con qué maestro da cada materia, calificaciones y tareas (en kinder: actividades y notas de la maestra), mensajes, calendario escolar y colegiaturas con aviso de pago vencido.
- **Profesor**: su horario de la semana, grupos con pase de lista, tareas y entregas (vista previa y calificación), anotaciones por alumno, mensajes y calificaciones con su propia forma de calificar. En kinder no hay calificación numérica.
- **Administración**: resumen de la escuela, alumnos, calendario escolar por nivel, pagos con recordatorios de adeudo, avisos y profesores. El recordatorio de pago va a los papás si el alumno es menor de edad, o al alumno si ya cumplió 18.
- **Accesos (administración)**: la escuela crea las cuentas; la contraseña se genera sola y solo se ve una vez, en la hoja que se imprime para la familia (todos los hijos y sus papás en una hoja). La primera vez, cada persona crea su propia contraseña. Control escolar no puede ver contraseñas ni cambiar a quién pertenece una cuenta: solo restablecerla si quien la pide da el correo registrado, y cada cambio queda en un registro que también ve el dueño de la cuenta.
- **Papá con varios hijos**: entra y ve una tarjeta por hijo (aunque estén en niveles distintos), se cambia de uno a otro, ve el total pendiente de la familia en Colegiaturas, y sus mensajes dicen de qué hijo se trata. En la demostración, `mama.secundaria` tiene a Pedro (secundaria) y a Lucía (primaria).
- **Grupos (administración)**: armar grupos y materias a mano o importarlos desde Excel (`plantilla_grupos.xlsx`, con revisión antes de guardar), asignar o cambiar al profesor de cada materia, cambiar alumnos de grupo (con motivo, aviso a los papás y anotación si fue por conducta) y registrar bajas o transferencias a otra escuela. Todo queda en el historial; la asistencia y calificaciones no se borran.
