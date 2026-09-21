# Verification: cómo saber que algo realmente está terminado

## El problema

Un agente que dice "ya terminé" no es una prueba de que terminó. Pudo olvidar
correr los tests, correrlos antes del último cambio, o simplemente asumir que
todo está bien.

Esta capability convierte "el agente dice que terminó" en evidencia que se
puede comprobar: **qué checks corrieron, sobre qué revisión exacta, y si
pasaron**.

## La idea en una frase

> Cada vez que corres tests, lint, typecheck o build, guardas el resultado
> atado a la revisión exacta del código. Si el código cambia, la evidencia
> anterior deja de valer automáticamente.

## Cómo se usa

El flujo normal tiene tres pasos:

```text
1. Corres el check con las herramientas normales de OpenCode
   (ej. npm run check, tsc, tests...)
   -> AndMar observa el resultado real vía el hook estable
      execute.after y guarda una evidencia mínima de ejecución
      (solo metadata: sesión, id interno, herramienta, comando
      y forma normalizada, estado, timestamp y digest opcional;
      nunca output completo)

2. Guardas el resultado con andmar_record_receipt indicando
   revisión, check, passed y el comando exacto
   (sin executionId: AndMar lo resuelve internamente por
   sesión actual + comando normalizado)
   -> queda archivado bajo verification/<revisión>/<check>
      y la evidencia queda ligada a esa revisión

3. Antes de dar algo por terminado, preguntas con andmar_verify_revision
   -> responde ok, o te dice qué falta, qué falló o qué está
      sin verificar (unverified)
```

Ejemplo: terminaste un cambio en la revisión `abc123` y corriste tests y
typecheck. Los registras uno por uno con el mismo comando que corrió:

```text
andmar_record_receipt(revision: "abc123", check: "tests", passed: true, command: "bun test")
andmar_record_receipt(revision: "abc123", check: "typecheck", passed: true, command: "bunx tsc --noEmit")
```

Después verificas:

```text
andmar_verify_revision(currentRevision: "abc123")
-> { ok: true }
```

Si luego editas un archivo, la revisión cambia a `def456` y al verificar:

```text
andmar_verify_revision(currentRevision: "def456")
-> { ok: false, missing: ["tests", "typecheck"] }
```

Tienes que volver a correr los checks. Esa es toda la magia: **nadie puede
reutilizar evidencia vieja por accidente**.

## Los dos comandos

| Comando | Para qué sirve |
|---|---|
| `andmar_suggest_checks` | Te sugiere qué comandos correr según lo que detecte en el proyecto (bun, npm, cargo, go, python...). Le pasas la lista de ficheros y no ejecuta nada. |
| `andmar_record_receipt` | Guardar el resultado de un check (`tests`, `lint`, `typecheck`, `build` o `custom`) para una revisión. |
| `andmar_verify_revision` | Preguntar si una revisión tiene todos los checks requeridos en verde. Por defecto pide `tests` y `typecheck`; puedes pedir otros. |

## ¿Cómo sabe qué comandos usa mi proyecto?

No lo adivina: mira señales deterministas. Tú (o el agente) le pasas la
lista de ficheros del proyecto con las herramientas normales de OpenCode y
la capability detecta el ecosistema por sus ficheros señal:

```text
bun.lock / bun.lockb  -> bun (bun test, bunx tsc --noEmit si hay tsconfig)
pnpm-lock.yaml        -> pnpm
package-lock.json     -> npm
yarn.lock             -> yarn
Cargo.toml            -> cargo (cargo test, cargo check, clippy, build)
go.mod                -> go (go test ./..., go vet, go build)
pyproject.toml,       -> python (pytest; uv/poetry/pipenv como prefijo
uv.lock, poetry.lock    si hay su lockfile; ruff/mypy solo si hay su config)
```

Además:

- Si le pasas los scripts de tu `package.json` (`test`, `lint`,
  `typecheck`, `build`), te sugiere esos comandos tal cual.
- Si hay varios ecosistemas (un monorepo con `Cargo.toml` y `go.mod`),
  te los devuelve todos, no solo uno.
- Si no reconoce nada, lo dice (`unknown`) en vez de inventar.
- Cada sugerencia dice su origen: `script` (estaba en tus scripts),
  `config` (hay su fichero de config) o `convention` (costumbre del
  ecosistema: conviene confirmar antes de correr).

Ejemplo:

```text
andmar_suggest_checks(files: ["package.json", "bun.lock", "tsconfig.json"])
-> bun: "bun test", "bunx tsc --noEmit"
```

Importante: sugerir no es ejecutar. Los comandos los corres tú con las
herramientas normales, y después guardas el resultado con
`andmar_record_receipt`.

## Qué significan las respuestas

- `ok: true` — todos los checks requeridos pasaron en esta revisión exacta con ejecución observada válida. Puedes continuar hacia el cierre.
- `missing: [...]` — esos checks no tienen resultado registrado para esta revisión. Hay que correrlos.
- `failed: [...]` — esos checks corrieron y fallaron. Hay que arreglar y volver a correr.
- `unverified: [...]` — esos checks tienen un receipt aprobado pero sin evidencia de ejecución válida (sin ejecución observada compatible, ejecución fallida, ejecución de otra sesión, comando distinto o evidencia ligada a otra revisión). Hay que correr el check de verdad en la sesión actual con el mismo comando y volver a registrarlo.

## Por qué `passed: true` solo no basta

Un receipt aprobado exige una ejecución real observada por OpenCode para ese
mismo comando en la sesión actual. El agente solo indica revisión, check,
passed y comando; AndMar resuelve internamente la ejecución compatible
(sesión + comando normalizado) y la liga al receipt con su `executionId`
interno para auditoría. La normalización es solo de espacios (trim + colapsar
espacios); cualquier otra diferencia de representación se rechaza en cerrado
y hay que volver a correr el comando exacto. Sin ejecución válida no se guarda
nada; una ejecución fallida jamás puede convertirse en receipt aprobado; una
ejecución de otra sesión o con otro comando tampoco sirve; y una evidencia
ligada a otra revisión no sirve para la actual. Si el código cambia
después del check, hay que volver a correrlo: la evidencia anterior queda
automáticamente invalidada.

## Cómo encaja con el resto

`andmar_verify_revision` es el paso previo natural de `andmar_completion_gate`
(de la capability `lifecycle`). La verificación dice "los checks pasaron";
el completion gate además revisa documentación y versionado antes de aceptar
el cierre. El gate no puede declararse formalmente verificado con
verificación requerida incompleta: un `testsPassed: true` manual nunca basta
cuando `verify_revision` reporta faltantes para la misma revisión. Para tareas
que genuinamente no requieren checks, el gate acepta `requiredChecks: []`
explícito.

```text
implementación
      |
      v
verification (checks en verde para esta revisión)
      |
      v
completion gate (docs + versión también en orden)
      |
      v
terminado de verdad
```

## Lo que NO hace

- **No ejecuta comandos.** Los checks los corres tú (o el agente) con las
  herramientas normales de OpenCode, con tus permisos de siempre. Esta
  capability solo archiva y comprueba resultados. Así nunca se salta ningún
  permiso.
- **No garantiza que los tests sean buenos.** Garantiza *que corrieron y
  pasaron sobre esta revisión exacta*, no que cubran lo importante. Escribir
  buenos tests sigue siendo trabajo humano (o del agente que implementa).
- **No publica ni versiona nada.** Solo detecta y archiva. Publicar es
  decisión de otra capability futura (`release`).
- **No automatiza la captura de la revisión.** La revisión se pasa como input
  explícito (normalmente un fingerprint del working state, no solo `HEAD`).
- **No poda el almacenamiento.** Evidencias y receipts se acumulan sin límite
  actual; solo el trace de intake está acotado (20 entradas).
