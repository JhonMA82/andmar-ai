# AndMar AI — Capabilities Guide

> Documento vivo para humanos y agentes.
>
> Este archivo describe cómo pensar, diseñar, activar y combinar capabilities en AndMar AI sin convertir el harness en un monolito.

## 1. Principio general

AndMar AI es **capability-oriented**, no agent-oriented.

Una capability representa una capacidad concreta del sistema:

- delegar trabajo,
- verificar una revisión,
- decidir qué modelo usar,
- evaluar impacto documental,
- administrar un workspace aislado,
- proyectar contexto,
- clasificar con Jev,
- validar un release,
- etc.

La regla principal es:

> **Instalar una capability no significa ejecutarla siempre.**

Cada capability puede estar:

```text
installed   -> el harness la conoce
enabled     -> puede utilizarse
activated   -> participa en este flujo o ejecución concreta
```

Una capability normal debe poder añadirse sin modificar el core. Si para incorporar una capability nueva hay que editar varios módulos existentes, probablemente la responsabilidad está en la capa equivocada o falta un contrato común.

---

## 2. Reglas de diseño

Toda capability nueva debe intentar cumplir estas reglas:

1. **Determinismo primero.**
   - Usar código, schemas, Git, hashes, metadata, estado y eventos antes que un LLM.
   - Usar Jev sólo para decisiones semánticas pequeñas y ambiguas.
   - Usar un frontier model sólo cuando el problema realmente requiera razonamiento profundo.

2. **Autocontenida.**
   - La capability contiene su configuración, schemas, policies, estado y tests.
   - No debe requerir modificar el core salvo que introduzca una primitive realmente nueva.

3. **Sin dependencias laterales ocultas.**
   - Una capability no debe importar directamente otra capability.
   - Las dependencias se declaran y las resuelve el runtime.

4. **Activación explícita o por condición.**
   - No ejecutar infraestructura que el trabajo actual no necesita.

5. **Autoridad no escalable.**
   - Una capability o workflow nunca debe obtener más autoridad que su sesión/flujo padre.

6. **Fail behavior explícito.**
   - Context optimization: normalmente `fail-open`.
   - Mutaciones, publicación o acciones destructivas: normalmente `fail-closed`.

7. **Estado durable separado del contexto.**
   - Lo que debe sobrevivir compactación o reinicio vive en storage, no en prompts.

---

## 3. Tipos de capabilities

### Core capabilities

Son pocas y forman parte del funcionamiento normal del harness.

Ejemplos:

```text
system
state
policy
routing
```

No deberían crecer mucho.

### Optional capabilities

Se habilitan según proyecto, workflow o necesidad.

Ejemplos:

```text
delegation
verification
workflow
decision
context
workspace
docs-integrity
release
git-policy
budget
observability
recovery
memory
```

---

# 4. Capabilities candidatas

## 4.1 `verification`

> Estado: implementada como `src/capabilities/verification/` con `andmar_suggest_checks`, `andmar_record_receipt` y `andmar_verify_revision`. Los checks se ejecutan por herramientas nativas de OpenCode; la capability solo sugiere (por señales deterministas), registra y evalúa receipts ligados a revisión exacta.

### Objetivo

Convertir “el agente dice que terminó” en evidencia verificable.

### Responsabilidades

- ejecutar tests;
- ejecutar lint;
- ejecutar typecheck;
- ejecutar build;
- ejecutar validadores específicos;
- generar receipts;
- asociar evidencia a una revisión exacta;
- invalidar evidencia cuando cambia la revisión.

### Ejemplo

```text
implementation
      |
      v
candidate completion
      |
      v
verification
  |- tests
  |- typecheck
  |- lint
  `- build
      |
      v
evidence bound to revision
```

### Activación

Recomendada en prácticamente todo cambio que modifique código.

### Dependencias

```text
state
lifecycle
```

---

## 4.2 `workflow`

### Objetivo

Ejecutar flujos declarativos sin convertir el LLM en una máquina de estados.

### Primitives iniciales

```text
sequence
parallel
gate
repeat
```

No añadir inicialmente:

- scripting arbitrario;
- workflows recursivos;
- DAG genérico;
- agent mesh;
- DSL compleja.

### Ejemplo

```yaml
workflow: feature-change

steps:
  - sequence:
      - implement
      - verify

  - repeat:
      maxRounds: 2
      steps:
        - review
        - correct
```

### Activación

Sólo cuando el trabajo realmente tenga múltiples pasos coordinados.

### Dependencias

```text
state
delegation
verification
```

---

## 4.3 `decision`

### Objetivo

Centralizar decisiones semánticas pequeñas.

Puede usar Jev u otro modelo especializado.

### Casos adecuados

```text
classify
score
choose
probability
relevance
```

### Regla

```text
Can code decide?
      |
     yes
      v
deterministic

     no
      |
      v
Can small decision model decide?
      |
     yes
      v
Jev / decision model

     no
      |
      v
frontier model
```

### Ejemplos

- `patch` vs `minor`;
- resultado de tool todavía relevante;
- riesgo `low|medium|high`;
- seleccionar entre estrategias ya conocidas.

### No usar para

- arquitectura;
- debugging profundo;
- implementación compleja;
- diseño de producto abierto.

---

## 4.4 `context`

### Objetivo

Controlar qué parte del historial necesita volver a enviarse al modelo.

No modifica la verdad histórica.

### Flujo

```text
full history
    |
    v
deterministic filters
    |
    v
semantic relevance if needed
    |
    v
temporary context projection
```

### Reglas típicas

```text
current turn                 -> keep
recent side-effect result    -> keep
huge old read                -> candidate
duplicated grep              -> candidate
resolved temporary output    -> candidate
```

### Comportamiento ante fallo

```text
fail-open
```

Si la reducción falla, se envía el contexto original.

### Activación

Cuando la sesión supera un umbral real de tamaño o coste.

No activarla por defecto sólo porque exista.

---

## 4.5 `workspace`

### Objetivo

Dar aislamiento reproducible a workers que modifican código.

### Primera implementación

Worktrees nativos de OpenCode/Git.

### Provider futuro posible

Lane para copy-on-write y reutilización eficiente de caches.

### Regla

```text
parallel writers > 1
        |
        v
isolated workspaces
```

### No sustituye

- merge/rebase;
- resolución de conflictos;
- revisión;
- verification.

---

## 4.6 `docs-integrity`

### Objetivo

Evitar documentación desactualizada después de cambios de código.

### Modelo

```text
changed artifact
      |
      v
documentation mapping
      |
      v
affected docs?
  |        |
 no       yes
  |        |
done    mark stale/review
```

### Ejemplos de mappings

```text
src/api/**          -> docs/api/**
cli/**              -> docs/cli.md
config/schema.*     -> docs/configuration.md
scaffolding/**      -> docs/scaffolding.md
```

### Resultado esperado

```text
clean
potentially-stale
needs-review
```

### Activación

Condicional:

```text
publicSurfaceChanged == true
OR
mappedArtifactChanged == true
```

---

## 4.7 `release`

### Objetivo

Comprobar si una revisión está preparada para release.

### Puede evaluar

```text
version bump
CHANGELOG
docs integrity
verification receipts
git state
release metadata
```

### Resultado

```text
not-required
not-ready
ready
```

### No hacer inicialmente

- publicar automáticamente;
- crear tags sin confirmación;
- hacer push;
- crear GitHub Releases.

Esas operaciones pueden añadirse más adelante con políticas explícitas.

---

## 4.8 `git-policy`

### Objetivo

Convertir convenciones Git importantes en reglas deterministas.

### Posibles checks

```text
clean working tree
branch policy
commit policy
no destructive commands without confirmation
no unresolved conflicts
no unintegrated worker changes
```

### Importante

No intentar imponer una estrategia Git universal.

La política debe ser configurable por proyecto.

---

## 4.9 `scaffold`

### Objetivo

Registrar y ejecutar boilerplates/generadores de forma determinista.

### Metadata útil

```text
id
source
version
arguments
defaults
generator commands
cleanup rules
AI context hints
```

### Ejemplo

```text
boilerplate selected
       |
       v
validate arguments
       |
       v
materialize
       |
       v
run deterministic generator
       |
       v
cleanup
       |
       v
emit project metadata
```

### Relación con Engineering Platform

Puede reutilizar patrones aprendidos allí, pero sin convertir AndMar AI en otra plataforma de boilerplates.

---

## 4.10 `project-context`

### Objetivo

Ofrecer al agente una representación pequeña, estable y estructurada del proyecto.

### Puede incluir

```text
architecture summary
important directories
public surfaces
commands
testing strategy
scaffolding
domain vocabulary
constraints
```

### Regla

No reemplaza exploración cuando hace falta.

Su objetivo es evitar exploración repetitiva innecesaria.

---

## 4.11 `impact-analysis`

### Objetivo

Analizar un diff y producir metadata reutilizable por otras capabilities.

### Salida posible

```json
{
  "publicSurfaceChanged": true,
  "docsAffected": true,
  "databaseChanged": false,
  "securitySensitive": false,
  "frontendOnly": false,
  "risk": "medium"
}
```

### Consumidores

```text
routing
verification
docs-integrity
release
risk-policy
```

Ésta puede convertirse en una capability especialmente valiosa porque reduce lógica duplicada.

---

## 4.12 `risk-policy`

### Objetivo

Determinar requisitos mínimos según riesgo.

### Ejemplo

```text
trivial frontend style
  -> fast model
  -> normal verification

authentication change
  -> >= standard model
  -> security checks
  -> stronger verification
  -> frontier review if configured
```

### Importante

Número de archivos no equivale a riesgo.

Una línea en autenticación puede ser más importante que veinte componentes visuales.

---

## 4.13 `budget`

### Objetivo

Limitar ejecución agentic.

### Límites posibles

```text
max workers
max depth
max rounds
max tokens
max cost
max wall time
```

### Regla

El LLM puede consumir presupuesto.

El LLM no puede ampliar sus propios límites.

---

## 4.14 `observability`

### Objetivo

Exponer estado semántico sin meter UI en el core.

### Estados sugeridos

```text
working
waiting
blocked
failed
done
```

### Consumidores posibles

- Herdr;
- TUI;
- logs;
- dashboards;
- CI.

### Regla

Observabilidad no debe interceptar ni cambiar la ejecución.

---

## 4.15 `recovery`

### Objetivo

Reconciliar operaciones con efectos externos después de timeouts, reinicios o resultados ambiguos.

### Regla principal

```text
unknown mutation result
        |
        v
inspect external truth
        |
        +-> already happened -> adopt state
        |
        +-> not happened     -> evaluate retry
        |
        `-> still unknown    -> block
```

Nunca:

```text
timeout -> blind retry
```

Especialmente útil para:

- GitHub;
- deploy;
- publicación;
- APIs externas;
- creación de recursos.

---

## 4.16 `memory`

### Objetivo

Guardar conocimiento semántico reutilizable entre sesiones.

### Prioridad

Baja inicialmente.

Antes deben estar resueltos:

```text
operational state
context projection
project-context
```

### Regla

```text
memory != state
memory != history
memory != context
```

Sólo añadir cuando exista una necesidad demostrada.

---

# 5. Model routing

Los workflows y capabilities no deberían nombrar modelos concretos.

Deben pedir perfiles:

```text
fast
standard
frontier
```

Ejemplo conceptual:

```yaml
models:
  fast: provider/model-fast
  standard: provider/model-standard
  frontier: provider/model-frontier
```

La selección se basa en metadata de la tarea:

```text
risk
scope
uncertainty
reasoningNeed
authority
sideEffects
```

### Ejemplo

```text
change button label
    -> FAST

bounded CRUD change
    -> FAST/STANDARD

small refactor
    -> STANDARD

architecture decision
    -> FRONTIER

security-critical review
    -> FRONTIER
```

### Escalamiento

Debe ser monotónico:

```text
fast -> standard -> frontier
```

No degradar y volver a escalar repetidamente.

---

# 6. Activación de capabilities

## Global

```yaml
capabilities:
  context: true
  decision: true
  workspace: false
```

## Proyecto

```yaml
capabilities:
  workspace: true
  release: true
```

## Workflow

```yaml
workflow: simple-change

capabilities:
  - routing
  - verification
  - lifecycle
```

## Condicional

```text
docs-integrity
  activate when publicSurfaceChanged

workspace
  activate when parallelWriters > 1

decision
  activate when deterministicDecision == unknown

frontier
  activate when risk == high
```

### Precedencia sugerida

```text
built-in defaults
      |
      v
user config
      |
      v
project config
      |
      v
workflow/request
```

Las hard policies no pueden ser anuladas desde un workflow.

---

# 7. Ejemplos de flujos

## 7.1 Cambio trivial de frontend

Solicitud:

> Cambia el texto del botón “Guardar” por “Guardar cambios”.

Capabilities:

```text
routing
verification
lifecycle
```

Modelo:

```text
FAST
```

No activar:

```text
delegation
workspace
workflow
decision
context
release
```

---

## 7.2 Feature normal

Capabilities:

```text
routing
delegation
verification
docs-integrity
lifecycle
```

Modelo inicial:

```text
STANDARD
```

Workspace:

```text
only if parallel writers > 1
```

---

## 7.3 Cambio sensible de autenticación

Capabilities:

```text
routing
risk-policy
verification
impact-analysis
docs-integrity
lifecycle
```

Policy:

```text
minimum model: STANDARD
review model: FRONTIER
security verification: required
```

---

## 7.4 ODD

ODD no debería convertirse en parte del core.

Debe consumir capabilities:

```text
ODD
 |
 +-> workflow
 +-> delegation
 +-> verification
 +-> lifecycle
 `-> routing
```

Ejemplo:

```text
implement
    |
    v
verify
    |
    v
review
  |     |
pass   fail
 |      |
done   correct
         |
         +----> verify
```

El loop lo ejecuta el runtime, no el prompt.

---

## 7.5 Product Plan

Capabilities posibles:

```text
routing
decision
project-context
```

No necesita por defecto:

```text
workspace
release
git-policy
```

Product Plan sigue siendo metodología/skill, no infraestructura.

---

## 7.6 Release

Capabilities:

```text
verification
docs-integrity
impact-analysis
release
git-policy
lifecycle
```

Hard requirements posibles:

```text
verification receipts current
docs clean
working tree clean
version consistent
CHANGELOG present
```

---

# 8. Dependencias

Una capability declara dependencias.

Ejemplo conceptual:

```ts
defineCapability({
  id: "release",
  requires: [
    "verification",
    "lifecycle"
  ]
})
```

El resolver construye:

```text
release
  |
  +-> verification
  `-> lifecycle
```

No se permiten imports directos entre capabilities.

---

# 9. Capability metadata

Para reducir `if` especiales por todo el sistema, tools/capabilities pueden declarar metadata común.

Ejemplo:

```yaml
authority: write
sideEffects: true
replayable: false
risk: medium
contextRetention: persistent
isolation: optional
verification: required
```

Con esa metadata el runtime puede responder preguntas como:

```text
¿puedo retry?
¿necesito confirmación?
¿puedo delegar?
¿puedo podar este resultado del contexto?
¿necesito worktree?
¿debo verificar?
¿fail-open o fail-closed?
```

---

# 10. Plantilla recomendada

Una capability simple debería tender a:

```text
src/capabilities/<name>/
├── index.ts
├── schema.ts
├── policy.ts
├── state.ts
└── tests/
```

No todos los archivos son obligatorios.

Una capability trivial puede ser sólo:

```text
src/capabilities/<name>/index.ts
```

No crear archivos vacíos sólo por seguir una estructura.

---

# 11. Criterio para agregar una capability

Antes de crear una nueva, preguntar:

```text
1. ¿OpenCode V2 ya lo resuelve?
2. ¿Puede resolverse con una función determinista pequeña?
3. ¿Es realmente reusable?
4. ¿Necesita estado?
5. ¿Necesita un LLM?
6. ¿Puede ser simplemente un skill?
7. ¿Puede ser una policy existente?
8. ¿Existe ya una capability que pueda extenderse sin acoplarla?
```

Crear una capability sólo cuando represente una capacidad reusable del runtime.

---

# 12. Anti-patrones

Evitar:

```text
one capability per command
one capability per agent
capability importing capability
hardcoded provider/model names
LLM routing every decision
automatic activation of everything
giant central config
giant registry manually maintained
hidden retries
silent fallbacks
runtime logic inside CLI
UI logic inside harness core
memory used as operational state
workflows implementing permissions
```

---

# 13. Prioridad sugerida después del MVP

Orden recomendado, sujeto a fricción real:

```text
1. verification
2. workflow
3. decision / Jev
4. context
5. impact-analysis
6. docs-integrity expansion
7. workspace
8. release / git-policy
9. budget
10. observability
11. recovery
12. memory, only if proven necessary
```

No implementar automáticamente en este orden.

La regla real sigue siendo:

> **Añadir sólo la siguiente capability que resuelva una fricción observada.**

---

# 14. Regla final para agentes

Al extender AndMar AI:

> Antes de añadir código, identifica si el problema pertenece al runtime, a una capability, a una policy, a un workflow o a un skill. Prefiere reglas deterministas, metadata, schemas, Git, storage y eventos antes que prompts. Una capability nueva debe ser autocontenida, registrarse por convención y no obligar a modificar el core. El hecho de que una capability esté instalada no significa que deba ejecutarse; actívala sólo cuando el flujo o una policy la necesiten.
