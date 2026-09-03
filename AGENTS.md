# AGENTS.md

Guía de contexto para cualquier agente (humano o IA) que trabaje en este proyecto.
Empezá por acá antes de tocar código o diseño.

---

## Design Context

Esta sección define la dirección de diseño y copy para **todas** las superficies
públicas del producto (hoy: `apps/web`, el sitio público). El portal autenticado
(`apps/portal`) y los bots heredan marca y voz pero tienen sus propias
convenciones de UI.

### Usuarios

**Usuario primario — el decisor en una concesionaria de autos.**

- Dueño o gerente comercial de una agencia de autos (usada, 0km, o mixta).
- Edad típicamente 35–60. No es técnico. Usa WhatsApp todo el día, Excel,
  Tal vez un CRM básico. Su computadora es para planillas y mail.
- **Contexto de uso**: está en la concesionaria, между vendiendo y gestionando.
  Entra al sitio desde el celular o una notebook, entre conversaciones.
- **Job to be done**: "Quiero dejar de perder oportunidades de venta que llegan
  por chat cuando nadie las atiende, sin tener que contratar más vendedores
  ni aprender tecnología nueva."
- **Vocabulario**: NO usa la palabra "lead". Habla de **oportunidades**,
  **potenciales compradores**, **interessados**, **clientes que vinieron por
  consulta**. El copy del sitio tiene que hablar su idioma, no el nuestro.

**Usuario secundario — el asesor / vendedor** que después opera el portal.
Misma marca, mismo tono, pero en el producto prioriza claridad operativa
sobre persuasión.

### Brand Personality

**Cercana · Práctica · Real (sin humo).**

- **Cercana**: habla como un buen asesor comercial, no como una corporación
  fría ni como un startupero de Silicon Valley. Vos, no "usted". Argentina
  en tono, pero prosa neutra-latam para poder escalar a otros países después.
- **Práctica**: cada frase sirve para algo. Nada de relleno. Si una sección
  no ayuda a decidir o a entender, la sacamos.
- **Real (sin humo)**: sin promesas vacías tipo "revolucioná tu negocio con IA".
  Mostramos qué hace el bot, cómo lo hace, y qué cuesta. Cero superlativos
  que no podamos sostener.

**Emociones a evocar**: "estos tipos entienden mi negocio" + "esto de verdad
me va a hacer vender más" + "no es complicado, lo puedo usar".

**Anti-emociones** (lo que NO queremos transmitir): tecnicismo frío, humo
marketinero, "startup premium" pretenciosa, urgencia manipuladora.

### Aesthetic Direction

**Referencia visual: Apple / Tesla.**

- **Aire**: mucho espacio en blanco (u off-white). Los elementos no compiten
  entre sí. Hero con un solo mensaje grande y mucho alrededor.
- **Tipografía grande**: títulos grandes y pesados, contraste fuerte con
  body pequeño y liviano. Inter para todo (display + body), weights 400–800.
- **Fotografía / ilustración**: NO includir imágenes genéricas de stock de
  personas sonrientes. Si metemos visuals, son del producto (capturas del
  portal, ejemplos de conversaciones reales) o abstractos (geometría sutil,
  gradientes muy suaves). Preferimos espacio vacío sobre imagen decorativa.
- **Layout**: secciones full-width con container interno centrado
  (max ~1152px). Mucho padding vertical entre secciones (py-20 a py-28).
- **Anti-referencias** (lo que NO queremos parecer):
  - SaaS genérico con gradientes morados/rosas y "✨ IA mágica ✨".
  - Sitios de autos usados saturados de banners, badges y emojis de fuego.
  - Dashboards densos tipo "mira cuánto podemos hacer".

### Paleta — "Enterprise" (Stripe/Linear/Vercel/Apple)

Aplicada vía CSS variables en `apps/web/src/styles/global.css` (HSL).
Tokens exactos del spec, manteniendo el sistema original.

- **Background**: blanco puro `0 0% 100%` (#FFFFFF).
- **Fondo secundario (muted)**: gris extremadamente claro `220 20% 97%`
  (#F8F9FB) — para alternar secciones.
- **Foreground**: negro casi absoluto `222 18% 11%` (#111827).
- **Texto secundario (muted-foreground)**: gris medio `220 9% 46%`
  (#6B7280).
- **Primary (azul intenso)**: `221 83% 53%` (#2563EB) — el único acento.
  CTAs, links, foco, highlights. Una marca, una dirección.
- **Primary-dark (azul oscuro)**: `224 67% 33%` (#1E3A8A) — apoyo, bloque
  de solución, sección Features en su variante oscura.
- **Border**: gris muy suave `220 13% 91%` (#E5E7EB).
- **Ring**: azul intenso (mismo que primary) para focus states.

**Reglas de uso del color**:

1. **Monocromático + azul como único acento.** Nunca introducir verde,
   ámbar, rojo (salvo estados destructivos puntuales), violeta.
2. El azul intenso `Primary` se reserva para CTAs y puntos de foco. Si todo
   es azul, nada destaca.
3. **Una sola sección oscura** (Features) como excepción deliberada y
   potente — fondo azul oscuro casi negro + cards oscuras. Es el único
   bloque dark del sitio. Lo demás es light.
4. Alternar fondo `background` (blanco) y `muted` (gris clarísimo) entre
   secciones para crear ritmo sin saturar.
5. Sin gradientes. Sin glassmorphism. Sin neón.

### Radios y sombras

- **Tarjetas**: 14px (`rounded-card`).
- **Botones**: 12px (`rounded-button`).
- **Sombras**: extremadamente sutiles. `shadow-xs`, `shadow-sm`, `shadow-md`
  definidos con opacidad muy baja (0.03–0.05). Nada de elevación dramática.

### Tipografía

- **Familia**: Inter (vía Google Fonts), un solo font para todo.
- **Display (h1/h2)**: `font-extrabold` (800), `tracking-tight`, tamaños
  grandes: `text-4xl` a `text-6xl` según jerarquía.
- **Body**: `font-normal` (400), `text-base` o `text-lg`.
- **Caption / micro**: `text-xs` o `text-sm`, `text-muted-foreground`.
- **Line-height**: generoso en body (`leading-relaxed`), tight en títulos.

### Copy — reglas de oro

1. **Nunca** usar la palabra "lead" en copy面向 cliente. Usar:
   **oportunidad**, **potencial comprador**, **interessado**, **consulta**.
   (Internamente, en código y docs técnicas, "lead" sigue siendo válido.)
2. **Vos**, no "usted". Pero prosa neutra-latam: evitar modismos muy
  argentinos que no se entiendan en México, Colombia, España.
3. Frases cortas. Una idea por oración. Si una oración tiene más de 22
   palabras, cortarla.
4. **Números concretos > superlativos**. "Responde en menos de 30 segundos"
   > "respuestas ultrarrápidas".
5. **Beneficio > feature**. "No perdés otra venta de noche" > "bot 24/7
   con motor de inferencia".
6. Cero emojis, cero signos de exclamación duplicados (!!), cero "✨ IA".
7. El CTA principal siempre es **"Pedir demo"** (o variante clara).
   Nunca "Saber más", "Descubrir", "Explorar" — son vagos.

### Tema

- **Light mode únicamente** (por ahora). No implementar dark mode ni toggle.
  La paleta está pensada para fondo claro. Si en el futuro se pide dark,
  se diseña una variante específica — no se invierte automáticamente.

### Design Principles

Reglas que guían toda decisión de diseño y copy en este proyecto:

1. **Aire sobre ruido.** Cuando hay duda entre agregar o sacar, sacar.
   El espacio vacío es una característica, no ausencia.
2. **Una idea por sección.** Cada bloque del sitio comunica una sola cosa.
   Si comunica dos, se parte en dos.
3. **Hablar como el cliente, no como nosotros.** "Oportunidad" antes que
   "lead". "Vender más" antes que "optimizar conversión". El cliente tiene
   que leer el sitio y pensar "esto es para mí".
4. **Premium no significa caro ni frío.** Significa cuidado en los detalles:
   alineación, tipografía, contraste, ritmo. La elegancia está en la
   ejecución, no en los adornos.
5. **Números y ejemplos > adjetivos.** Mostrar cómo funciona con capturas
   reales o ejemplos concretos siempre le gana a describirlo con palabras.

---

## Notas de implementación

- Los tokens de color viven en `apps/web/src/styles/global.css` como variables
  HSL (mismo formato que el portal, para coherencia).
- El wordmark es "Hermes Leads" + ícono `Sparkles` (placeholder hasta que
  exista logo custom). Cambio de marca futuro = cambio en un solo lugar
  (`Navbar.astro`, `Footer.astro`, `Layout.astro`).
- El sitio es 100% estático (Astro), sin JS por defecto salvo el script del
  form de demo y eventuales islas interactivas.
