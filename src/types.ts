export type EmployeeCategory = "profesional" | "empleado"

/**
 * `hourly` paga por hora trabajada; `daily` paga una tarifa fija por cada día
 * laborado; `fixed` paga un monto único por la quincena completa —como un
 * salario mensual repartido en dos—, sin importar los días u horas
 * registrados, salvo que una ausencia lo recorte.
 */
export type PaymentType = "hourly" | "daily" | "fixed"

/** Qué ocurrió en un día del período. `trabajo` usa entrada/salida; el resto son días completos. */
export type DayType = "trabajo" | "feriado" | "vacaciones" | "incapacidad" | "ausencia" | "descanso"

/** El horario habitual de un colaborador para un día de la semana. */
export interface DaySchedule {
  works: boolean // false = día libre
  entryTime: string // HH:MM
  exitTime: string // HH:MM
  lunchBreak: boolean
  lunchDuration: number // minutos
}

/**
 * Horario semanal: siempre 7 posiciones, indexadas igual que `Date.getDay()`
 * (0 = domingo … 6 = sábado), para poder buscar el día directamente sin
 * traducir índices en cada llamada.
 */
export type WeeklySchedule = DaySchedule[]

export interface Employee {
  id: string
  name: string
  idNumber: string // cédula / pasaporte
  position: string // cargo
  startDate: string // fecha de ingreso, YYYY-MM-DD ('' si no se registró)
  category: EmployeeCategory
  paymentType: PaymentType
  hourlyRate: number // usado cuando paymentType es "hourly"
  dailyRate: number // usado cuando paymentType es "daily"
  fixedSalary: number // usado cuando paymentType es "fixed": monto por quincena completa
  schedule: WeeklySchedule // horario habitual, usado para prellenar el registro
  // Deductions (only for empleados, but customizable)
  socialSecurityRate: number // default 9.75 for empleados, 0 for profesionales
  educationRate: number // default 1.25 for empleados, 0 for profesionales
  active: boolean
}

export interface TimeEntry {
  id: string
  employeeId: string
  date: string // YYYY-MM-DD
  dayType: DayType
  entryTime: string // HH:MM — solo aplica a dayType 'trabajo' y 'feriado'
  exitTime: string // HH:MM
  lunchBreak: boolean
  lunchDuration: number // in minutes, default 60
  overtimeRate: number // multiplier, e.g. 1.5 means 50% extra. 1.0 = normal pay
  notes: string
  /**
   * Respaldo del día: sobre todo la foto o el certificado de una incapacidad.
   * Vacío en la enorme mayoría de los registros.
   */
  attachments: Attachment[]
}

export interface PayPeriod {
  year: number
  month: number
  half: 1 | 2 // 1 = days 1-15, 2 = days 16-end
}

/** Planilla congelada: el cálculo queda fijo aunque después cambien tarifas o registros. */
export interface ClosedPeriod {
  id?: string
  revision?: number
  supersedes?: string
  key: string // `${year}-${month}-${half}`
  period: PayPeriod
  closedAt: string // ISO timestamp
  summaries: EmployeeSummary[]
  /** Datos de origen para reimprimir sin usar tarifas/asistencia actuales. */
  snapshot?: Pick<AppData, "companyName" | "employees" | "timeEntries" | "manualAdjustments" | "loans" | "overtimeThreshold" | "standardDayHours" | "holidayRate" | "payVacations" | "payHolidays" | "paySickLeave">
}

export type PayrollAdjustmentKind = "bono" | "descuento"

/** Ajuste manual de nómina aplicado a un colaborador en una quincena. */
export interface PayrollAdjustment {
  id: string
  employeeId: string
  periodKey: string // `${year}-${month}-${half}`
  kind: PayrollAdjustmentKind
  amount: number
  note: string
  createdAt: string // ISO timestamp
}

export interface AppData {
  employees: Employee[]
  timeEntries: TimeEntry[]
  currentPeriod: PayPeriod
  overtimeThreshold: number // hours per day before overtime kicks in, default 8
  standardDayHours: number // jornada usada para pagar días completos (vacaciones, feriado no trabajado)
  holidayRate: number // multiplicador de las horas trabajadas en feriado
  payVacations: boolean // ¿se paga la jornada estándar en día de vacaciones?
  payHolidays: boolean // ¿se paga el feriado no trabajado?
  paySickLeave: boolean // ¿el patrono paga la incapacidad? (en Panamá suele pagarla la CSS)
  closedPeriods: ClosedPeriod[]
  /** Cierres anteriores: se añaden al reabrir y nunca se reemplazan. */
  payrollArchives: ClosedPeriod[]
  manualAdjustments: PayrollAdjustment[]
  transactions: Transaction[]
  counterparties: Counterparty[]
  budgets: Budget[]
  loans: Loan[]
  goals: FinancialGoal[]
  costs: CostEntry[]
  costTemplates: CostTemplate[]
  costOperators: CostOperator[]
  costCashCounts: CostCashCount[]
  /** Servicios que se pagan cada mes (luz, agua…). Los rangos por sección no los reciben. */
  fixedExpenses: FixedExpense[]
  fixedExpensePayments: FixedExpensePayment[]
  /** Gastos sueltos del día a día (gasolina, comida…). Mismo acceso que los fijos. */
  dailyExpenses: DailyExpense[]
  /** Pagos a empresas y proveedores hechos por administración. */
  supplierPayments: SupplierPayment[]
  /** Si los gastos de cada lista se anotan también en Contabilidad. */
  expenseSettings: ExpenseSettings
  /** Dinero en caja/banco al inicio, antes del primer movimiento registrado. */
  openingBalance: number
  openingBalanceDate: string // YYYY-MM-DD ('' = sin fecha declarada)
  /**
   * Con el módulo apagado la aplicación se reduce a nómina: desaparecen la
   * pestaña de Contabilidad, sus exportaciones y el estado de resultados del
   * dashboard. Los movimientos no se borran, solo dejan de mostrarse.
   */
  accountingEnabled: boolean
  theme: "light" | "dark" | "system"
  companyName: string
  version: number
}

export type TransactionType = "ingreso" | "gasto"

/**
 * `pagado` ya movió dinero real; `pendiente` es una cuenta por cobrar o por
 * pagar. La diferencia es la base de todo el flujo de caja: el saldo actual
 * solo cuenta lo pagado, y lo pendiente alimenta «por entrar / por salir».
 */
export type TransactionStatus = "pagado" | "pendiente"

export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "cheque" | "otro"

/** Cada cuánto se repite un movimiento. `ninguna` = movimiento único. */
export type Recurrence = "ninguna" | "semanal" | "quincenal" | "mensual" | "anual"

/**
 * Archivo adjunto: comprobante de un movimiento o foto de una incapacidad.
 *
 * Puede vivir en tres sitios, y siempre exactamente en uno:
 * - `path`: en el almacenamiento de la nube. Es lo normal cuando la empresa
 *   está sincronizada; el archivo no viaja dentro de los datos.
 * - `url`: en otro lado (Drive, correo), y aquí solo queda la dirección.
 * - `dataUrl`: dentro de este navegador. Es lo que hacía la versión sin nube
 *   y lo que se sigue usando sin conexión; al subir la empresa se trasladan
 *   al almacenamiento.
 */
export interface Attachment {
  id: string
  name: string
  mime: string
  size: number // bytes del archivo original
  dataUrl: string
  path?: string
  url?: string
}

/** Movimiento contable manual: gasto o ingreso fuera de la nómina. */
export interface Transaction {
  id: string
  date: string // YYYY-MM-DD — cuándo se devengó
  dueDate: string // YYYY-MM-DD — cuándo se cobra/paga ('' = misma que date)
  type: TransactionType
  status: TransactionStatus
  category: string
  description: string
  amount: number
  recurrence: Recurrence
  paymentMethod: PaymentMethod
  counterpartyId: string // '' si no se asoció a nadie
  tags: string[]
  attachments: Attachment[]
}

export type CounterpartyKind = "cliente" | "proveedor"

/** Cliente o proveedor al que se asocian los movimientos. */
export interface Counterparty {
  id: string
  name: string
  kind: CounterpartyKind
  taxId: string // RUC / cédula
  contact: string // teléfono o correo
  notes: string
}

/** Techo de gasto mensual esperado para una categoría. */
export interface Budget {
  id: string
  category: string
  monthlyLimit: number
}

/**
 * Préstamo o adelanto a un colaborador. Las cuotas se descuentan solas de la
 * planilla a partir de la quincena inicial.
 *
 * El saldo no se guarda como número mutable —eso obligaría a "rehacer los
 * pagos" cada vez que se corrige una fecha— pero tampoco se deriva solo de las
 * quincenas transcurridas: cuando el neto no alcanza para la cuota completa se
 * descuenta menos, y esa diferencia hay que recordarla o el préstamo se daría
 * por saldado teniendo saldo. Por eso `charges` guarda lo efectivamente
 * cobrado en cada quincena cerrada.
 */
export interface Loan {
  id: string
  employeeId: string
  date: string // YYYY-MM-DD en que se entregó
  amount: number // monto total prestado
  installment: number // cuota a descontar por quincena
  /** Primera quincena en la que se descuenta, `${year}-${MM}-${half}`. */
  startPeriodKey: string
  /**
   * Lo realmente descontado por quincena cerrada, `periodKey` → monto. Las
   * quincenas sin registro usan la cuota teórica: aún no se han pagado.
   */
  charges: Record<string, number>
  notes: string
  active: boolean // false = condonado o suspendido, deja de descontar
}

export type GoalKind = "ahorro" | "reducir-gastos" | "aumentar-ingresos"

/** Objetivo financiero con fecha límite, para medir avance. */
export interface FinancialGoal {
  id: string
  kind: GoalKind
  title: string
  target: number
  deadline: string // YYYY-MM
  createdAt: string // YYYY-MM-DD
}

/** Cobro: entra efectivo a caja. Pago: sale. */
export type CostMovementKind = "cobro" | "pago"

/**
 * Movimiento de efectivo en caja: un cobro o un pago a una empresa o
 * persona, fuera de la planilla. Vive aparte de `Transaction` porque nace de
 * un registro más simple (un renglón por movimiento, sin estado
 * pendiente/pagado ni recurrencia) y necesita quién lo procesó, algo que un
 * movimiento contable no registra.
 */
export interface CostEntry {
  id: string
  date: string // YYYY-MM-DD
  recipientName: string // a quién se le pagó o quién pagó
  /** Los registros anteriores a este campo eran todos pagos. */
  kind: CostMovementKind
  taxId: string // RUC / cédula
  concept: string // de qué es el movimiento
  quantity: number // unidades o cantidad del bien/servicio
  amount: number // monto en USD, siempre positivo; el signo lo da `kind`
  comment: string
  processedBy: string // encargada/o que procesó el pago
  /** Cuándo se registró (ISO); '' en pagos anteriores a este campo. */
  createdAt: string
}

/**
 * Perfil guardado de una empresa o persona frecuente, para no volver a
 * teclear su nombre y RUC en cada movimiento.
 */
export interface CostTemplate {
  id: string
  recipientName: string
  taxId: string
  /** Oculta también la sugerencia proveniente de movimientos anteriores. */
  hidden?: boolean
}

/**
 * Perfil de quien registra pagos, con un PIN corto para dar cuenta de que
 * quien capturó un pago es quien dice ser. No es una cuenta con permisos —
 * solo evita que un pago quede atribuido a la persona equivocada por
 * descuido durante un cambio de turno.
 */
export interface CostOperator {
  id: string
  name: string
  /** Huella SHA-256 del PIN de 4 dígitos (ver hashPin en utils/costs.ts) — nunca el PIN en claro. */
  pin: string
}

export type CostCashCountKind = "apertura" | "cierre"

/**
 * Arqueo de caja de una encargada: cuánto efectivo había al abrir su turno
 * (opcional) y cuánto quedó al cerrarlo, para poder cuadrar las cuentas
 * contra los pagos registrados en medio.
 */
export interface CostCashCount {
  id: string
  kind: CostCashCountKind
  operatorName: string
  at: string // ISO timestamp
  cashOnHand: number // efectivo en caja, en USD
  notes: string
}

/**
 * Gasto fijo: un servicio que llega a cobrarse todos los meses (internet,
 * agua, luz, basura). Vive aparte de la contabilidad a propósito: es una
 * lista de control para el administrador —¿ya se pagó la luz de este mes?—
 * y no alimenta el flujo de caja ni el estado de resultados.
 */
export interface FixedExpense {
  id: string
  name: string // "Luz", "Internet"
  provider: string // empresa que cobra
  accountNumber: string // NIS, número de contrato o de cliente
  /** Lo que suele llegar, para estimar el mes mientras no hay factura. 0 = sin estimar. */
  estimatedAmount: number
  /** Día del mes en que vence (1–31; se ajusta en meses más cortos). 0 = sin fecha. */
  dueDay: number
  /**
   * Cada cuántos meses llega la factura: 1 mensual, 2 bimestral, 3
   * trimestral, 6 semestral, 12 anual. Se cuenta desde `startMonth`; los
   * meses intermedios no se cobran y no aparecen como pendientes.
   */
  frequency: FixedExpenseFrequency
  /**
   * Si al marcar pagado se anota también un gasto en Contabilidad, para que
   * el flujo de caja y el estado de resultados lo incluyan sin teclearlo
   * dos veces.
   */
  recordInAccounting: boolean
  /** Primer mes que se controla, `YYYY-MM`: los anteriores no cuentan como vencidos. */
  startMonth: string
  notes: string
  active: boolean // false = servicio dado de baja; se conserva su historial
  /**
   * Meses en que estuvo dado de baja, para que al reactivarlo esos meses no
   * aparezcan como vencidos. `to` es exclusivo; '' = sigue de baja.
   */
  pauses: FixedExpensePause[]
}

export type FixedExpenseFrequency = 1 | 2 | 3 | 6 | 12

export interface FixedExpensePause {
  from: string // YYYY-MM, primer mes sin cobro
  to: string // YYYY-MM en que volvió a cobrarse; '' mientras siga de baja
}

/**
 * Un pago de la factura de un mes. El mes queda saldado con un pago que no
 * es abono; antes de eso puede tener varios abonos.
 */
export interface FixedExpensePayment {
  id: string
  expenseId: string
  month: string // YYYY-MM de la factura que se paga
  amount: number // lo pagado en este pago
  /** Abono: se pagó una parte y la factura sigue pendiente. */
  partial: boolean
  /** Gasto que se anotó en Contabilidad por este pago; '' si ninguno. */
  transactionId: string
  paidOn: string // YYYY-MM-DD
  paymentMethod: PaymentMethod
  reference: string // número de factura o de comprobante
  notes: string
  attachments: Attachment[]
  createdAt: string // ISO
}

/**
 * Gasto suelto del día a día: gasolina, comida, un taxi. Puede haber varios
 * el mismo día o pasar semanas sin ninguno; se anota rápido y ya pagado.
 * Como los fijos, vive aparte de Contabilidad salvo que se pida anotarlo.
 */
export interface DailyExpense {
  id: string
  date: string // YYYY-MM-DD
  category: string // "Gasolina", "Comida"…
  amount: number
  paymentMethod: PaymentMethod
  paidBy: string // quién lo pagó o a quién se le reembolsa ('' = no se anotó)
  notes: string
  attachments: Attachment[]
  /** Gasto que se anotó en Contabilidad por este; '' si ninguno. */
  transactionId: string
  createdAt: string // ISO
}

/**
 * Pago de administración a una empresa o proveedor: como un pago de Caja,
 * pero con factura y forma de pago, y sin turnos ni encargadas.
 */
export interface SupplierPayment {
  id: string
  date: string // YYYY-MM-DD
  supplierName: string // nombre o razón social
  taxId: string // RUC / cédula
  dv: string // dígito verificador del RUC ('' si no aplica, p. ej. cédula)
  concept: string // qué se compró o pagó
  invoiceNumber: string
  amount: number // total pagado, impuesto incluido
  /**
   * ITBMS incluido en el total (0 = sin impuesto o no se anotó). Va aparte
   * porque el contador lo necesita separado para el crédito fiscal.
   */
  itbms: number
  paymentMethod: PaymentMethod
  notes: string
  attachments: Attachment[]
  transactionId: string
  createdAt: string // ISO
}

export interface ExpenseSettings {
  dailyToAccounting: boolean
  suppliersToAccounting: boolean
}

/** Conteo de días por tipo dentro del período. */
export type DayCounts = Record<DayType, number>

export interface EmployeeSummary {
  employee: Employee
  regularHours: number
  overtimeHours: number
  holidayHours: number // horas efectivamente trabajadas en día feriado
  leaveHours: number // horas pagadas sin trabajar (vacaciones / feriado / incapacidad)
  regularPay: number // base imponible (horas regulares + días pagados)
  overtimePay: number // pago de extras (sin descuentos)
  holidayPay: number // recargo por trabajar en feriado (sin descuentos)
  /**
   * Salario bruto del período: `regularPay + holidayPay`.
   *
   * Las horas extra quedan FUERA a propósito: son un pago aparte que se informa
   * y se entrega junto con el salario, pero no forma parte del sueldo. Mezclarlas
   * aquí hacía que el bruto de una quincena con muchas extras no se pudiera
   * comparar con el de otra.
   */
  grossSalary: number
  socialSecurityDeduction: number // solo sobre regularPay
  educationDeduction: number // solo sobre regularPay
  loanDeduction: number // cuota de préstamo o adelanto descontada en el período
  totalDeductions: number // seguro social + educativo + préstamo
  /**
   * Bonos (+) y descuentos (−) manuales ya aplicados al neto.
   *
   * Se guarda aparte de `totalDeductions` porque no es una retención de ley:
   * mezclarlo ahí descuadraría el reporte de seguro social. Sin este campo el
   * neto no se podría explicar desde el bruto en ninguna exportación.
   */
  manualAdjustment: number
  /** Salario neto, sin horas extra: `grossSalary - totalDeductions + manualAdjustment`. */
  netSalary: number
  /**
   * Lo que efectivamente se entrega: `netSalary + overtimePay`.
   *
   * Es la única cifra que representa dinero saliendo de caja, así que es la que
   * usan el flujo de efectivo, la contabilidad y el cierre de planilla.
   */
  totalPay: number
  entriesCount: number // días con registro de cualquier tipo
  daysWorked: number // días con horas efectivas
  dayCounts: DayCounts
}
