# Planilla — Nómina y Gestión de Colaboradores

Aplicación web para calcular la planilla quincenal de servicios profesionales y empleados
regulares: registro de horas, deducciones de ley, comprobantes de pago y reportes.

## Qué hace

- **Registro quincenal** en cuadrícula tipo hoja de cálculo, navegable con teclado, con
  llenado masivo por rango de días y vista alterna para móvil.
- **Tipos de día**: trabajado, feriado, vacaciones, incapacidad y ausencia, con reglas de
  pago configurables.
- **Cálculo**: horas regulares y extra con recargo por día, umbral de jornada, recargo de
  feriado y deducciones de seguro social y educativo sobre el salario base.
- **Turnos nocturnos**: una jornada que cruza la medianoche (22:00 → 06:00) se paga completa.
- **Cierre de quincena**: congela el cálculo para que cambiar una tarifa después no reescriba
  una planilla ya pagada.
- **Exportación**: planilla en Excel, reporte consolidado en PDF y comprobante de pago
  individual por colaborador.
- Modo claro y oscuro.

## Dónde viven los datos

Todo se guarda en el `localStorage` del navegador. **No hay servidor y nada sale del equipo.**
Esto tiene dos consecuencias:

- Los datos no se comparten entre navegadores ni entre computadoras.
- Si borras los datos de navegación, se pierde la planilla.

Exporta un respaldo JSON con regularidad desde **Configuración → Respaldo y datos**.

## Desarrollo

```bash
pnpm install
pnpm dev
```

El servidor arranca en `http://localhost:8443` (o el puerto en `PORT`).

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` | Build de producción en `dist/` |
| `pnpm preview` | Sirve el build de producción |
| `pnpm exec tsc --noEmit` | Chequeo de tipos |

### Aviso sobre `pnpm format`

El formateador del proyecto (oxfmt 0.2.0) **elimina los `;` dentro de los tipos de objeto
escritos en una sola línea**, produciendo TypeScript inválido: `{ start: string; end: string }`
se convierte en `{ start: string end: string }` y el proyecto deja de compilar.

Por eso todos los tipos de objeto están declarados como `interface` con nombre. Escribirlos
en varias líneas no basta: si son cortos, el formateador los colapsa y los vuelve a romper.
Después de cualquier `pnpm format`, verifica con `pnpm exec tsc --noEmit`.

## Despliegue

Cada push a `main` dispara el workflow de GitHub Actions que construye el sitio y lo publica
en GitHub Pages. La ruta base se toma del nombre del repositorio mediante la variable
`BASE_PATH`, así que renombrar el repositorio no rompe los enlaces a los assets.

## Stack

React 19 · Vite 8 · Tailwind CSS 4 · Recharts · jsPDF · SheetJS
