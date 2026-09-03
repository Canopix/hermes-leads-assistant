import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emptySoulFields,
  looksLikeSoul,
  markdownFromSoul,
  soulFromMarkdown,
} from '../src/lib/soul-wizard'

const canovaMd = readFileSync(
  join(__dirname, '../../../examples/canova-cars/SOUL.md'),
  'utf-8'
)

const travelMd = [
  '# Lead AI Assistant — Río Gallegos Viajes',
  '',
  'Eres el asistente de captación para una agencia de viajes.',
  '',
  '## Tu única operación',
  '',
  '- Informar paquetes y excursiones disponibles.',
  '- Completar el lead con los datos del viajero.',
  '',
  '## Qué captar cuando hay interés',
  '',
  '- Nombre',
  '- Destino de interés',
  '- Cantidad de viajeros',
].join('\n')

describe('soul-wizard', () => {
  describe('looksLikeSoul', () => {
    it('reconoce SOUL.md reales', () => {
      expect(looksLikeSoul(canovaMd)).toBe(true)
      expect(looksLikeSoul(travelMd)).toBe(true)
    })

    it('acepta markdown vacio como wizard usable', () => {
      expect(looksLikeSoul('')).toBe(true)
    })

    it('rechaza markdown que no tiene las secciones conocidas', () => {
      expect(looksLikeSoul('# readme\n\nfoo bar baz\n')).toBe(false)
    })
  })

  describe('soulFromMarkdown / markdownFromSoul (round-trip)', () => {
    it('parsea canova-cars y regenera sin perder secciones clave', () => {
      const fields = soulFromMarkdown(canovaMd)
      expect(fields.businessName).toBe('Canova Cars')
      expect(fields.rubro).toBe('agencia de venta de automóviles')
      expect(fields.botDoes.length).toBeGreaterThan(0)
      expect(fields.botDoesNot.length).toBeGreaterThan(0)
      expect(fields.leadFields).toContain('Nombre')
      expect(fields.leadFields.some((f) => f.startsWith('Vehículo de interés'))).toBe(true)
      expect(fields.precios).toMatch(/referencia/i)
      expect(fields.cierre.length).toBeGreaterThan(0)
      expect(fields.antiAlucinacion.length).toBeGreaterThan(0)

      const regenerated = markdownFromSoul(fields)
      // Las secciones reconocidas deben reaparecer
      expect(regenerated).toMatch(/## Tu única operación/)
      expect(regenerated).toMatch(/## Qué NO hacer/)
      expect(regenerated).toMatch(/## Qué captar cuando hay interés/)
      expect(regenerated).toMatch(/## Precios/)
      expect(regenerated).toMatch(/## Cierre/)
      expect(regenerated).toMatch(/## Anti-alucinación/)
      expect(regenerated).toMatch(/# Lead AI Assistant — Canova Cars/)
    })

    it('preserva secciones desconocidas en extra', () => {
      const mdWithExtra =
        '# Lead AI Assistant — X\n\nIntro.\n\n## Tu única operación\n\n- Foo\n\n## Sección rara\n\n- Bar\n'
      const fields = soulFromMarkdown(mdWithExtra)
      expect(fields.botDoes).toEqual(['Foo'])
      expect(fields.extra).toContain('Sección rara')
      expect(fields.extra).toContain('Bar')

      const out = markdownFromSoul(fields)
      expect(out).toContain('Sección rara')
    })

    it('vacío devuelve emptySoulFields', () => {
      expect(soulFromMarkdown('')).toEqual(emptySoulFields)
    })

    it('markdownFromSoul(empty) produce algo válido', () => {
      const out = markdownFromSoul(emptySoulFields)
      expect(out.trim()).toBe('# Lead AI Assistant')
    })

    it('round-trip estable para agencia de viajes (fixture inline)', () => {
      const fields = soulFromMarkdown(travelMd)
      expect(fields.businessName).toBe('Río Gallegos Viajes')
      const out = markdownFromSoul(fields)
      expect(out).toMatch(/## Tu única operación/)
      expect(out).toMatch(/## Qué captar cuando hay interés/)
    })
  })
})
