import { useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { fmt } from "../../utils/calculations"
import type { MonthSummary } from "../../utils/accounting"
import type { CashFlow } from "../../utils/finance"
import { formatDate, todayISO } from "../../utils/dates"
import Icon from "../Icon"
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Modal,
  inputNumClass,
} from "../ui"
import type { ViewProps } from "../Contabilidad"
import { AXIS_TICK, ChartTooltip, Kpi, Money, compactMoney } from "./shared"

interface Props extends ViewProps {
  cash: CashFlow
  projected: MonthSummary[]
}

export default function FlujoCaja({
  data,
  cash,
  projected,
  onChange,
  onNotify,
}: Props) {
  const [editOpening, setEditOpening] = useState(false)

  // Saldo acumulado mes a mes: es la lectura que responde «¿me alcanza?».
  let running = cash.saldoActual
  const chartData = [
    { name: "Hoy", Saldo: +cash.saldoActual.toFixed(2) },
    ...projected.map((m) => {
      running += m.flujoNeto
      return { name: m.label, Saldo: +running.toFixed(2) }
    }),
  ]

  const lowest = Math.min(...chartData.map((d) => d.Saldo))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Dinero disponible hoy"
          value={`${
            cash.saldoActual < 0 ? "−" : ""
          }$${fmt(Math.abs(cash.saldoActual))}`}
          tone={cash.saldoActual >= 0 ? "ok" : "danger"}
          icon="wallet"
          emphasis
          sub="Saldo inicial + cobrado − pagado − nómina"
        />
        <Kpi
          label="Por entrar"
          value={`$${fmt(cash.porEntrar)}`}
          tone="brand"
          icon="trendUp"
          sub={
            cash.porEntrarVencido > 0 ? (
              <span className="text-danger font-semibold">
                ${fmt(cash.porEntrarVencido)} ya vencidos
              </span>
            ) : (
              "Cuentas por cobrar al día"
            )
          }
        />
        <Kpi
          label="Por salir"
          value={`$${fmt(cash.porSalir)}`}
          tone="amber"
          icon="trendDown"
          sub={
            cash.porSalirVencido > 0 ? (
              <span className="text-danger font-semibold">
                ${fmt(cash.porSalirVencido)} ya vencidos
              </span>
            ) : (
              `Incluye $${fmt(cash.nominaComprometida)} de nómina`
            )
          }
        />
        <Kpi
          label="Saldo proyectado"
          value={`${
            cash.saldoProyectado < 0 ? "−" : ""
          }$${fmt(Math.abs(cash.saldoProyectado))}`}
          tone={cash.saldoProyectado >= 0 ? "ok" : "danger"}
          icon="scale"
          sub="Si se cobra y se paga todo lo pendiente"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="De dónde sale el saldo de hoy"
            subtitle="Solo cuenta lo que ya movió dinero"
            action={
              <Button
                size="sm"
                icon="edit"
                onClick={() => setEditOpening(true)}
              >
                Saldo inicial
              </Button>
            }
          />
          <ul className="space-y-0.5">
            <Row
              label="Saldo inicial"
              hint={
                data.openingBalanceDate
                  ? `declarado al ${formatDate(data.openingBalanceDate)}`
                  : "sin fecha declarada"
              }
              value={cash.openingBalance}
              tone="muted"
            />
            <Row label="Ingresos cobrados" value={cash.cobrado} tone="ok" />
            <Row label="Gastos pagados" value={-cash.pagado} tone="danger" />
            <Row
              label="Nómina pagada"
              hint="quincenas ya cerradas en el calendario"
              value={-cash.nominaPagada}
              tone="danger"
            />
            <li className="flex items-center justify-between gap-3 pt-2.5 mt-1.5 border-t border-line">
              <span className="text-sm font-bold text-fg">
                Dinero disponible
              </span>
              <Money value={cash.saldoActual} className="text-base" />
            </li>
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Compromisos pendientes"
            subtitle="Lo que aún no se ha cobrado ni pagado"
          />
          <ul className="space-y-0.5">
            <Row
              label="Cuentas por cobrar"
              hint={
                cash.porEntrarVencido > 0
                  ? `$${fmt(cash.porEntrarVencido)} vencidos`
                  : undefined
              }
              value={cash.porEntrar}
              tone="ok"
            />
            <Row
              label="Cuentas por pagar"
              hint={
                cash.porSalirVencido > 0
                  ? `$${fmt(cash.porSalirVencido)} vencidos`
                  : undefined
              }
              value={-cash.gastosPendientes}
              tone="danger"
            />
            <Row
              label="Nómina comprometida"
              hint="quincenas en curso o futuras"
              value={-cash.nominaComprometida}
              tone="danger"
            />
            <Row
              label="Préstamos por recuperar"
              hint="se descuentan solos de la planilla"
              value={cash.prestamosPorCobrar}
              tone="brand"
            />
            <li className="flex items-center justify-between gap-3 pt-2.5 mt-1.5 border-t border-line">
              <span className="text-sm font-bold text-fg">
                Saldo si todo se liquida
              </span>
              <Money value={cash.saldoProyectado} className="text-base" />
            </li>
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Cómo evoluciona la caja"
          subtitle="Saldo acumulado mes a mes según lo comprometido y el ritmo reciente"
          action={
            lowest < 0 ? (
              <Badge tone="danger">
                <Icon name="alert" className="w-3 h-3" />
                Llega a negativo
              </Badge>
            ) : undefined
          }
        />
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--line)"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={AXIS_TICK}
              axisLine={false}
              tickLine={false}
              tickFormatter={compactMoney}
              width={62}
            />
            <Tooltip content={<ChartTooltip />} />
            {/* La línea de cero es la referencia que de verdad importa. */}
            <ReferenceLine y={0} stroke="var(--danger)" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="Saldo"
              stroke="var(--brand)"
              strokeWidth={2.5}
              fill="url(#saldoFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-[11px] text-subtle mt-2">
          Proyección basada en compromisos registrados, movimientos recurrentes
          y el promedio de los meses recientes. No es una promesa: cambia en
          cuanto registras algo nuevo.
        </p>
      </Card>

      {editOpening && (
        <SaldoInicialModal
          balance={data.openingBalance}
          date={data.openingBalanceDate}
          onSave={(openingBalance, openingBalanceDate) => {
            onChange({ openingBalance, openingBalanceDate })
            onNotify("Saldo inicial actualizado")
            setEditOpening(false)
          }}
          onClose={() => setEditOpening(false)}
        />
      )}
    </div>
  )
}

function Row({
  label,
  hint,
  value,
  tone,
}: {
  label: string
  hint?: string
  value: number
  tone: "ok" | "danger" | "muted" | "brand"
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm text-fg truncate">{label}</span>
        {hint && (
          <span className="block text-[11px] text-subtle truncate">{hint}</span>
        )}
      </span>
      <Money value={value} tone={tone === "muted" ? "muted" : tone} />
    </li>
  )
}

function SaldoInicialModal({
  balance,
  date,
  onSave,
  onClose,
}: {
  balance: number
  date: string
  onSave: (balance: number, date: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(balance)
  const [when, setWhen] = useState(date || todayISO())

  return (
    <Modal
      title="Saldo inicial de caja"
      subtitle="El dinero que ya tenías antes del primer movimiento registrado"
      onClose={onClose}
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={() => onSave(value, when)}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted leading-relaxed">
          Sin este dato, el flujo de caja arranca en cero y va a mostrar un
          saldo negativo aunque el negocio tenga dinero. Anota lo que había en
          efectivo y banco a la fecha que indiques.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Monto (USD)">
            <input
              type="number"
              step="0.01"
              value={value || ""}
              onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              autoFocus
              className={inputNumClass}
            />
          </Field>
          <Field label="A la fecha">
            <input
              type="date"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className={inputNumClass}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
