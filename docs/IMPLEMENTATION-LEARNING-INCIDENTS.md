# Entrega — Project Learning y Runtime Incidents (AndMar 0.18.0)

Implementado sobre `main` 0d90ed88afb171376945ca85bc7911f143fb495c (0.17.0).
La arquitectura encontrada ya tenía capacidades aisladas, eventos locales de
observabilidad, Work Ledger portátil y autoridades separadas de Verification y
Completion. Se preservaron esas fronteras. Contrato completo:
[LEARNING-INCIDENTS.md](LEARNING-INCIDENTS.md).

## Archivos añadidos

- `src/capabilities/learning/index.ts`: dos herramientas con operaciones explícitas.
- `src/capabilities/learning/capture.ts`: ventana acotada de outcomes nativos.
- `src/capabilities/learning/project-learning.ts`: candidatos, deduplicación,
  drop, promoción/merge, ownership y auditoría.
- `src/capabilities/learning/runtime-incidents.ts`: incidentes, recurrencia,
  referencias de ejecución, recovery y candidatos de regresión.
- `src/capabilities/learning/persistence.ts`: JSON, lock exclusivo y escritura
  atómica, corrupción tolerada y protección de symlinks.
- `src/capabilities/learning/safety.ts`: límites, normalización y saneamiento.
- `tests/learning-incidents.test.ts`: 23 tests nuevos, incluidos PL-01–09,
  RI-01–10, recuperación, publicación interrumpida, ownership y no bloqueo.
- `docs/LEARNING-INCIDENTS.md` y este informe.

## Archivos modificados

| Superficie | Archivos | Motivo |
| --- | --- | --- |
| Core | `src/core/capability.ts` | Observar excepciones inesperadas de hooks/tools propios sin cambiar su throw original |
| Lifecycle | `src/capabilities/lifecycle/work.ts` | Referencias compactas de WU/última transición; señal invalid-ledger; conservar inspección y reparación |
| Verification | `src/capabilities/verification/index.ts` | Señal específica si desaparece backing execution de un receipt aprobado |
| Revisión/checkpoints | `scripts/working-state-revision.mjs`, `scripts/work-unit-checkpoint.mjs`, `scripts/work-ledger-lifecycle.mjs` | Excluir sidecars diagnósticos del estado de producto y touched files |
| Aceptación nativa | `assets/skills/andmar-acceptance/scripts/runtime-acceptance.mjs` | Fallo/corrección/success, incident/recovery, restart y promoción/discovery reales; catálogo remoto deshabilitado |
| Pruebas de revisión | `tests/working-state-revision.test.ts` | Contrato actualizado de exclusiones |
| Generados | `src/generated/capabilities.ts`, `src/generated/version.ts`, `docs/CAPABILITIES.md` | Regenerados con el script oficial |
| Versión/documentación | `package.json`, `CHANGELOG.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/ANDMAR-AI-CAPABILITIES.md`, `docs/STATE.md`, `docs/VERIFICATION.md`, `docs/TESTING.md`, `docs/DECISIONS.md` | 0.18.0 y contrato público documentado |

No se añadieron dependencias ni configuración. No hay llamada adicional al LLM,
Review, background agent, memoria general, embeddings, base de datos o servicio.
El refresco asíncrono es una única llamada al scanner nativo de skills; nunca una
llamada de modelo ni una condición de completion.

## Qué hacen los dos mecanismos

Project Learning conserva la pareja comprobada: fallo de proceso → corrección
nativa → éxito del mismo comando. Propone un candidato. El foreground decide
promote/drop/merge y proporciona la conclusión reutilizable con evidencia.
Las skills son archivos convencionales `.opencode/skills/<nombre>/SKILL.md`.

Runtime Incidents sólo registra fronteras internas. Un `npm test` con exit 1
no genera incidente. Un Ledger inválido o evidencia propia perdida sí. La
recuperación modifica el mismo INC y la repetición incrementa occurrences.
Las referencias de ejecución explican trabajo interrumpido al reanudar; no
sustituyen el estado del Ledger. Cancellation/external/project outcomes requieren
una declaración explícita con explicación.

Work Ledger sigue siendo la verdad del trabajo. Verification conserva autoridad
sobre receipts. Completion conserva su gate y se observa mediante el evento
existente. Los sidecars nunca invalidan esos receipts por escribirse. Las skills
promovidas sí son cambios de producto y requieren la verificación correspondiente.

## Validación

- `bun run check`: arquitectura, manifiestos y typecheck contra el paquete real
  `@opencode/plugin@2.0.4`; suite completa **313/313**, sin skips.
- Aceptación real en **OpenCode 2.0.22**: **11/11 checks** con herramientas,
  hooks, storage, scanner de skills y restart de servidor reales.
- El modelo de aceptación es una fixture local determinista. No comprueba
  calidad semántica de un modelo; sí las fronteras mecánicas del runtime.
- Prueba crítica: Ledger inválido conserva read y reparación nativa; luego
  Verification/Completion finalizan. El recorder no registra un execute.before gate.
- Un refresco del catálogo que no termina no atrapa la herramienta de promoción.

## Ejemplo real de candidato capturado

Del escenario nativo `npm test` → write correctivo → `npm test` exit 0:

```json
{
  "id": "PL-ad6d0796",
  "kind": "RECOVERED_FAILURE",
  "problem": "shell command 'npm test' failed (exit 1)",
  "solution": "After native write, the same command succeeded. Foreground must distill the reusable procedure before promotion.",
  "evidence": "Observed execute.after failure → native write → same-command exit 0",
  "hits": 1,
  "status": "pending"
}
```

La aceptación después promovió explícitamente una skill normal
`native-test-recovery` y la cargó con la herramienta nativa `skill`. No se promovió
por la mera detección de la pareja.

## Ejemplo real de incidente con recovery

Del escenario nativo de EV-8 duplicado, reparación y flujo completado:

```json
{
  "id": "INC-d03998ab",
  "flow": "work.execute",
  "workId": "recovery-0",
  "workUnit": "WU-1",
  "expected": "execute → verify → completion → finalize",
  "lastSuccess": "work.activate",
  "failedAt": "ledger.validate",
  "component": "lifecycle",
  "category": "invalid-ledger",
  "error": "Error: Ledger validation failed: Duplicate ID: EV-8",
  "status": "resolved",
  "regressionCandidate": true,
  "recovery": "Repaired owning Ledger with native write",
  "recoveryEvidence": "Owning work_status confirms valid state"
}
```

El restart real también conservó `WU-2`, `work.complete` como última transición y
la secuencia esperada. La causa quedó expresamente desconocida hasta diagnóstico;
no se inventó una clasificación failed-andmar.

## Cambio de core y límites restantes

El único cambio de core es el adaptador genérico de observación en setup de
capacidades. Era necesario porque un observer independiente no puede capturar
la excepción lanzada por otro hook. No contiene política Learning/Incident,
state, rutas ni imports a capacidades. Mantiene la excepción original.

Límites deliberados:

- Pairing automático conservador: mismo comando y outcome de proceso observable;
  otras técnicas se anotan de forma explícita foreground.
- Higiene determinista y atestación de provenance no prueban la calidad semántica
  ni reconocen todos los secretos arbitrarios sin formato identificable.
- Interrupciones se explican al rebind; no se infiere la causa de un SIGKILL.
  Dos procesos vivos compartiendo el mismo work pueden parecer un restart.
- Notices automáticos usan stderr del host; su visibilidad depende del UI. Las
  herramientas status/pending/list devuelven notices sin leer archivos manualmente.
- Registros y tombstones tienen retención finita; un drop puede volver a proponerse
  después de salir de esa retención. El límite de bytes puede actuar antes que el
  límite de cantidad. Busy/stale locks generan advertencia, nunca un gate.
- Recovery evidence foreground queda auditada; no convierte un receipt falso en
  válido ni reemplaza la autoridad del gate de Verification/Completion.
