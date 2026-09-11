import { describe, expect, it } from "vitest"
import { displayUser, toLoginEmail } from "./client"

describe("usuarios en lugar de correos", () => {
  it("completa el usuario con el dominio interno", () => {
    expect(toLoginEmail("douglas")).toBe("douglas@planilla.local")
    expect(toLoginEmail("  Kathy ")).toBe("kathy@planilla.local")
  })

  it("acepta un correo completo tal cual", () => {
    expect(toLoginEmail("Ameth@RysBioservices.com")).toBe("ameth@rysbioservices.com")
  })

  it("muestra solo el usuario en las cuentas internas", () => {
    expect(displayUser("douglas@planilla.local")).toBe("douglas")
    expect(displayUser("alguien@gmail.com")).toBe("alguien@gmail.com")
    expect(displayUser(null)).toBe("")
  })
})
