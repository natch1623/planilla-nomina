# Correcciones de integridad y persistencia — 22/10/2026

## Estado de entrega

Implementadas sobre `76bad63`. **Activadas el 26/10/2026**: se tomó un respaldo fresco (2 empresas, revisiones 547 y 9), se verificó con `scripts/verify-business-backup.mjs` y se aplicó `supabase/migrations/20261022143152_data_integrity.sql` en el proyecto real (2 versiones base capturadas, `delete_company` y la validación de documentos activas). La web se publicó a continuación junto con la pestaña Gastos. El esquema para instalaciones nuevas incorpora exactamente la misma migración y se prueba su reaplicación.

Los cálculos laborales y las tasas no se modifican. El régimen laboral panameño sigue pendiente de definir. La versión del documento subió a 15 con este trabajo y a 16 con la pestaña Gastos, para que clientes anteriores que consultan la nube detecten la incompatibilidad.

## Cambios y límites

| Área | Corrección | Comportamiento visible |
|---|---|---|
| Carga local | `decodeStoredData` rechaza datos ausentes, ilegibles, incompletos, de versión futura o cuya normalización descartaría registros. | Pantalla de recuperación; no se inicia una empresa vacía ni se sincroniza ese fallback. |
| Escrituras | Comparación con la copia leída, comprobación de desaparición, validación previa y una copia local anterior antes de reemplazar. | Si falla la cuota o hay un cambio externo, se detiene el guardado y se puede exportar la memoria y los datos locales disponibles. |
| Migración antigua | Destino e índice deben guardarse antes de retirar `planilla_data`. | Un fallo conserva el original. Un índice ilegible se recupera explícitamente sin crear una empresa ficticia. |
| Pestañas | Web Locks permite una pestaña editora por origen; la segunda espera sin montar sincronización. | Se habilita automáticamente cuando cierra la primera. Sin Web Locks queda la comparación de versión local, que no equivale a una transacción entre pestañas simultáneas. |
| Sincronización | Operaciones vinculadas a perfil, empresa, sesión y generación; comprobar contexto tras cada espera. Se protege la edición hecha durante una descarga, subida o fusión. | Respuestas antiguas se descartan; conflictos válidos conservan la edición local. No se sube un documento pendiente de guardado local. |
| Metadatos | Vínculos dañados o cuyo guardado falla bloquean la sincronización. Una revisión remota solo se adopta después de guardar el documento. | No aparece una confirmación falsa de sincronización. Los vínculos dañados conservan sus bytes para diagnóstico; no se reasignan empresas automáticamente. |
| Cierres | Nuevos cierres guardan identificador, revisión, datos de origen y resúmenes. Reabrir archiva la versión anterior. La fusión respeta registros protegidos. | Se puede corregir y recerrar sin perder el cierre previo, incluso sin sincronizar el estado intermedio. Las reimpresiones usan los datos congelados disponibles. |
| Historial remoto | Snapshots privados de cada revisión, con autor y fecha de captura, sin UPDATE/DELETE para usuarios de la app. RPC de consulta exige administración y lectura completa. | Configuración → Nube → Historial permite descargar las últimas 100 revisiones para revisión o recuperación en otra empresa. Las anteriores siguen almacenadas en la base. |
| Eliminación remota | Borrado lógico; conserva empresa, miembros y versiones. RPC de restauración comprueba permisos. | Desaparece del listado. La recuperación administrativa puede revertir el borrado; no se ofrece restauración destructiva automática desde la pantalla de historial. |
| Servidor | Validación estructural y protección de cierres, cuotas e historial también en UPDATE completo. Se retira TRUNCATE y fijan search_path de cinco funciones. | Un documento incompleto se rechaza. Borrar legítimamente el último registro sigue permitido y deja una versión recuperable. |
| Adjuntos | Desvincular no destruye el objeto. Políticas restrictivas impiden UPDATE/DELETE de objetos del bucket `adjuntos` para authenticated. No se migran archivos inline de asistencias cerradas. | Los archivos históricos permanecen disponibles. Su depuración física requiere un proceso posterior de retención que compruebe referencias e historial. |

Los cierres anteriores que no tienen foto de origen conservan sus resúmenes, pero sus entradas históricas no pueden reconstruirse con certeza. Los campos legacy `manualAdjustment`/`totalPay` se comparan con la misma normalización en cliente y servidor.

El historial es inmutable para los roles de la aplicación. Un administrador de PostgreSQL conserva poderes para alterar el sistema; no se presenta como una garantía frente a un administrador de base hostil. Los cambios exclusivos de membresías no generan por sí solos un evento histórico independiente.

## Respaldo realizado y restauración comprobada

Se creó una copia privada fuera del repositorio (22/10/2026), y otra fresca antes de activar (26/10/2026). Ninguna se guarda en el repositorio, que es público.

- Contiene las dos empresas completas, siete membresías, cinco roles y definiciones de funciones, políticas, índices, constraints y triggers capturados.
- Revisiones capturadas: 512 y 9. Se comprobaron todos los campos de las tres tablas públicas al restaurar en PostgreSQL aislado y se compararon documentos/revisiones antes y después de la migración.
- También se ejecutó el lector estricto de la aplicación sobre las dos empresas reales copiadas: ningún registro fue descartado.
- SHA-256: `e75224e37a8aca09a6041ead43ab8367bdbdc362a0d2a346a461abe3c8218c77`.
- No es un respaldo integral de Supabase: no incluye cuentas/contraseñas Auth ni archivos Storage. Al capturarlo había cero objetos Storage. Los usuarios de Auth se simulan solo en la prueba aislada para comprobar referencias, no se restauran cuentas reales.
- Esta copia puntual y el historial dentro de la misma base no sustituyen respaldos periódicos fuera del proveedor. No se contrató PITR, configuró un plan de pago ni programó una automatización externa.

## Verificación reproducible

```powershell
npm test
npx tsc --noEmit
npm run build
node scripts/verify-business-backup.mjs 'C:\Users\ameth\.codex\backups\nomina\2026-10-22\respaldo-negocio.json'
```

Las pruebas añaden casos de JSON truncado, `null`, listas inválidas, cuota llena en distintos pasos, índice perdido, escritura obsoleta o borrado por otra pestaña, descarga 200 frente a edición 999, saldo 1250→1500, edición 1700 durante subida 1500 y respuesta de A después de cambiar A→B→A. La prueba de cuotas/cierres conserva una primera versión de 8h×$10=$80 y una corrección de 8h×$20=$160. Los tests SQL comprueban RLS, descargas autorizadas del historial, inmutabilidad, borrado/restauración lógica, adjuntos y cierres legacy.

Resultado final: 277 pruebas aprobadas en 21 archivos, comprobación TypeScript y build correctos. La prueba de Chrome no registró errores de página. Permanece el aviso de bundle inicial superior a 500 kB; esta entrega no es una optimización de carga.

Prueba de navegador opcional: iniciar `npm run dev -- --host 127.0.0.1 --port 8444 --strictPort`, tener Playwright y Chrome disponibles y ejecutar `node scripts/verify-local-ui.mjs`. `PLAYWRIGHT_MODULE` permite indicar la instalación de Playwright del entorno y `PLAYWRIGHT_CHANNEL` elegir `chrome` o `msedge`. La prueba crea un contexto efímero y solo datos sintéticos. Comprueba StrictMode, dos pestañas, guardado/recarga, conservación de JSON dañado y recuperación sin desbordamiento horizontal a 375 px. No usa la sesión personal del navegador.

## Activación y reversión

1. Obtener una copia fresca antes de activar: la copia de este trabajo representa su momento de captura, no futuras ediciones de usuarios.
2. Verificar nuevamente la restauración y conservar la versión anterior de la web. Coordinar la activación de migración y frontend: clientes antiguos que intenten DELETE directo recibirán error; los cierres reabiertos deben conservar el archivo.
3. Aplicar la migración de integridad en el proyecto correcto. Es aditiva: no reemplaza `companies.data` ni recalcula salarios. Registrar sus resultados y comparar documentos/revisiones con la copia fresca.
4. Publicar el frontend validado y pedir recarga de las pestañas anteriores. Confirmar con dos usuarios los rangos, pendientes, conflictos y una operación de prueba autorizada; no fabricar nóminas o pagos en la empresa real para hacer QA.
5. Consultar avisos de seguridad y logs después de activar. Verificar snapshots, permisos TRUNCATE, archivos y cierres.

Si el frontend necesita reversión, conservar las tablas de historial y sus snapshots. No eliminar el historial ni restaurar una copia vieja sobre toda la base activa: podrían perderse cambios posteriores. Una reversión de permisos/RPC exige evaluar el cliente anterior y mantener bloqueadas las operaciones incompatibles hasta corregirlo. Para recuperar una empresa borrada, un administrador autorizado puede llamar `public.restore_deleted_company(p_company)`; consultar/recuperar una versión histórica debe crear una revisión nueva o abrir otra empresa, preservando los cierres ya archivados.

## Fuentes de implementación

- [Supabase: respaldos y exclusión de objetos Storage](https://supabase.com/docs/guides/platform/backups).
- [MDN: Web Locks, cancelación y opciones incompatibles](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request).
- [PostgreSQL: RLS y operaciones que no quedan cubiertas](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

La revisión de límites y de regresiones se realizó siguiendo el skill `codex-security:fix-finding`, con dos revisiones independientes de solo lectura. Resultado de este trabajo: correcciones locales verificadas; activación remota pendiente. No equivale a una auditoría completa de seguridad, recuperación ante desastres o WCAG.
