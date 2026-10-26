import { describe, expect, it } from "vitest"
import { defaultData, mergeAppData, normalizeData } from "../store"
import { assertPayrollIntegrity, closePayroll, payrollReportData, reopenPayroll } from "./payrollClosure"
import { calcPeriodSummaries, rulesFrom } from "./calculations"
import { migrateAttachments, countInlineAttachments } from "../cloud/attachments"

const data = () => normalizeData({ ...defaultData, companyName: "Origen", currentPeriod: { year: 2026, month: 10, half: 1 },
  employees: [{ id: "e1", name: "Sintético", hourlyRate: 10, paymentType: "hourly", category: "profesional" }],
  timeEntries: [{ id: "t1", employeeId: "e1", date: "2026-10-01", dayType: "trabajo", entryTime: "08:00", exitTime: "17:00", lunchBreak: true, lunchDuration: 60, attachments: [] }],
})
const close = (d = data()) => closePayroll(d, calcPeriodSummaries(d.employees,d.timeEntries,d.currentPeriod,rulesFrom(d)))

describe("cierres y reportes históricos", () => {
  it("congela 8h × $10 = $80 y conserva inputs al cambiar tarifa/empresa", () => {
    const original = close()
    expect(original.closedPeriods[0].summaries[0].totalPay).toBe(80)
    const changed = { ...original, companyName: "Actual", employees: original.employees.map(e => ({ ...e, hourlyRate: 20 })), overtimeThreshold: 6 }
    assertPayrollIntegrity(original, changed)
    const report = payrollReportData(changed)
    expect(report.companyName).toBe("Origen")
    expect(report.employees[0].hourlyRate).toBe(10)
    expect(report.overtimeThreshold).toBe(8)
  })
  it("reabrir y recerrar sin guardado intermedio preserva $80 y genera revisión 2 de $160", () => {
    const first = close()
    const reopened = reopenPayroll(first)
    const changed = { ...reopened, employees: reopened.employees.map(e => ({ ...e, hourlyRate: 20 })) }
    const second = close(changed)
    expect(() => assertPayrollIntegrity(first,second)).not.toThrow()
    expect(second.payrollArchives[0].summaries[0].totalPay).toBe(80)
    expect(second.closedPeriods[0].summaries[0].totalPay).toBe(160)
    expect(second.closedPeriods[0].revision).toBe(2)
    expect(second.closedPeriods[0].supersedes).toBe(first.closedPeriods[0].id)
  })
  it("rechaza borrar el cierre, sus entradas o modificar el archivo", () => {
    const first = close()
    expect(() => assertPayrollIntegrity(first,{ ...first,closedPeriods: [] })).toThrow("historial")
    expect(() => assertPayrollIntegrity(first,{ ...first,timeEntries: [] })).toThrow("cerrada")
    const reopened = reopenPayroll(first)
    expect(() => assertPayrollIntegrity(reopened,{ ...reopened,payrollArchives: [] })).toThrow("historial")
  })
  it("la fusión conserva asistencia y ajustes del periodo cerrado del destino", () => {
    const first = close()
    const incoming = { ...data(),timeEntries: [{ ...data().timeEntries[0],exitTime: "20:00" }] }
    const result = mergeAppData(first,incoming).data
    expect(result.timeEntries[0].exitTime).toBe("17:00")
    expect(() => assertPayrollIntegrity(first,result)).not.toThrow()
  })
  it("no migra ni elimina adjuntos inline de periodos cerrados", async () => {
    const source = data()
    source.timeEntries[0].attachments = [{ id: "a1",name: "prueba.png",mime: "image/png",size: 4,dataUrl: "data:image/png;base64,aG9sYQ==" }]
    const closed = close(source)
    let uploads = 0
    const result = await migrateAttachments(closed,"company",async () => { uploads++ })
    expect(uploads).toBe(0)
    expect(countInlineAttachments(closed)).toBe(0)
    expect(result.data.timeEntries[0].attachments[0].dataUrl).toBe(source.timeEntries[0].attachments[0].dataUrl)
    expect(() => assertPayrollIntegrity(closed,result.data)).not.toThrow()
  })
})
