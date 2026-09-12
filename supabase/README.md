# Configurar la nube (Supabase)

La app funciona sin esto: si el build no trae credenciales de Supabase, todo se
guarda solo en el navegador, igual que siempre. Estos pasos activan la versión
compartida.

## 1. Crear el proyecto

1. Entra a <https://supabase.com> y crea una cuenta (el plan gratuito alcanza).
2. **New project**. Nombre: `planilla`. Guarda la contraseña de la base de datos
   en un lugar seguro (la app no la usa, pero Supabase la pide).
3. Región: la más cercana (p. ej. `East US`).

## 2. Crear las tablas y los permisos

1. En el proyecto: **SQL Editor → New query**.
2. Pega todo el contenido de [`schema.sql`](schema.sql) y dale **Run**.
   Debe terminar con "Success. No rows returned".

Se puede volver a correr sin romper nada si más adelante cambia el script.

## 3. Cerrar el registro público

Las cuentas las creas tú; nadie debe poder registrarse solo.

1. **Authentication → Sign In / Providers**. En **Email**, deja activo
   *Enable Email provider* y **desactiva** *Allow new users to sign up*.
2. **Authentication → Users → Add user → Create new user**, una por persona.
   - **Email**: `usuario@planilla.local` — por ejemplo `douglas@planilla.local`,
     en minúsculas, sin tildes ni espacios. En la app la persona escribe solo
     `douglas`; ese correo no existe ni recibe nada.
   - **Password**: una temporal de al menos 8 caracteres.
   - Marca *Auto Confirm User*.

   Cada quien puede cambiar su contraseña luego en Configuración → Nube. Si
   alguien la olvida, se la cambias desde esta misma pantalla.

## 4. Conectar la app

En **Project Settings → API** (o **Data API**) copia:

- **Project URL** → `VITE_SUPABASE_URL`
- **anon public** key → `VITE_SUPABASE_ANON_KEY`

La anon key es pública por diseño: lo que protege los datos son las políticas
del paso 2, que exigen sesión y membresía en la empresa. **Nunca** uses la
`service_role` key en la app.

### Para el sitio publicado (GitHub Pages)

En GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, crea `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. El workflow de
despliegue ya los pasa al build.

### Para probar en tu computadora

Crea un archivo `.env.local` en la raíz del proyecto (está en `.gitignore`):

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## 5. Primer uso

1. Abre la app, botón de nube arriba a la derecha → inicia sesión.
2. Con la empresa que quieres compartir abierta: **Configuración → Nube →
   Subir a la nube**. Quedas como *Administrador*.
3. En la misma tarjeta, agrega a las demás personas por su usuario y elige su
   rango. Cada empresa tiene su propia lista de personas.

4. Ellas inician sesión en su equipo y abren la empresa desde el selector de
   empresas (sección "En la nube").

| Rango | Qué puede hacer |
| --- | --- |
| Administrador | Todo, incluido agregar y quitar personas y borrar la empresa de la nube |
| Editor | Ve y modifica todos los datos |
| Solo lectura | Ve todo, no modifica nada |
| Asistencia | Solo el Registro Diario: anota horas, feriados, vacaciones, incapacidades. Recibe los colaboradores **sin** tarifas, salarios ni cédula y no ve montos. No puede tocar días de quincenas cerradas |
| Costos | Solo la lista de costos: registra y edita pagos, con sus beneficiarios frecuentes y las encargadas de turno. La nube nunca le envía salarios, registro diario ni el resto de la empresa. *(Se habilita en la app cuando esté el módulo de Costos.)* |

### Costos: la cuenta de nube y el PIN de turno

En Costos hay dos identidades y no son lo mismo:

- **La cuenta de nube** (por ejemplo `caja`) identifica la **computadora**:
  dice qué estación puede sincronizar los pagos. Es la que aparece en «último
  guardado de…».
- **El PIN de turno** identifica a la **persona**: cada encargada entra con su
  nombre y su PIN, y eso es lo que queda en cada pago como quién lo procesó.

Varias encargadas comparten la misma cuenta de nube en una estación. Sus
perfiles y PIN sí se sincronizan, así que las mismas personas pueden trabajar
en cualquier computadora. El PIN se guarda cifrado: ni la nube ni el navegador
conservan el número.

Para cambiar el rango de alguien, elige el nuevo en la lista junto a su nombre.

## Crear un rango nuevo

Los rangos viven en la tabla **roles** (Table Editor → `roles`). Cada fila
combina:

| Columna | Qué significa |
| --- | --- |
| `role` | Nombre interno, sin espacios (p. ej. `supervisor`) |
| `label` | Nombre que se ve en la app (p. ej. `Supervisor`) |
| `description` | Texto de ayuda al asignarlo |
| `reads_all` | Ve la empresa completa, salarios incluidos |
| `writes_all` | Modifica la empresa completa |
| `manages_members` | Agrega y quita personas |
| `sections` | Secciones sueltas que ve y edita: `{asistencia}`, `{costos}` o `{asistencia,costos}` |
| `sort` | Orden en la lista |

Ejemplo: alguien que registra horas **y** pagos, sin ver salarios → **Insert
row** con `role = asistencia_costos`, `label = Asistencia y costos`,
`sections = {asistencia,costos}` y lo demás en `false`. Aparece solo en la
app; no hay que tocar código.

Una **sección nueva** (por ejemplo, "solo contabilidad") sí requiere
programarla: el servidor tiene que saber qué parte de la empresa entrega y
cuál acepta.

## Archivos adjuntos

Los comprobantes de Contabilidad y las fotos o certificados de incapacidad no
viajan dentro de los datos de la empresa: van al almacenamiento de archivos de
Supabase (bucket `adjuntos`, 1 GB en el plan gratuito) y en los datos solo
queda su ubicación. Así un cambio de horas no reenvía todas las fotos.

- Los adjuntos que ya existían dentro de los datos se trasladan solos la
  primera vez que la empresa se sincroniza.
- Sin conexión o sin nube se siguen guardando en el navegador, y se trasladan
  cuando hay conexión.
- También se puede pegar el enlace de un documento que viva en Drive u otro
  lado, en vez de subir el archivo.
- Quién ve qué: los comprobantes, cualquiera que pueda ver la empresa. Las
  fotos de incapacidad, por ser datos médicos, solo Administrador, Editor y
  el rango Asistencia, que es quien las registra.

Los enlaces a los archivos son temporales y se piden en el momento: nadie que
no tenga acceso a la empresa puede abrirlos, aunque le pasen la dirección.

## Cómo se comporta

- Cada equipo guarda primero en su navegador y sube a la nube ~1,5 s después
  del último cambio. Sin internet sigue funcionando y sube al reconectar.
- Cuando otra persona guarda, los demás reciben el cambio solos (en vivo, o al
  volver a la pestaña).
- La quincena que cada quien está viendo y el tema claro/oscuro **no** se
  comparten.
- Si dos personas editan a la vez sin haberse sincronizado, la app pregunta
  cuál versión conservar y permite descargar la propia como respaldo.

## Límites a tener en cuenta

- Los comprobantes adjuntos viajan dentro del JSON de la empresa. Muchos
  adjuntos grandes hacen más lenta cada subida; el plan gratuito da 500 MB de
  base de datos.
- Supabase pausa los proyectos gratuitos tras una semana sin actividad; se
  reactivan desde el panel.
