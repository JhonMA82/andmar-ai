# Aceptación local — AndMar 0.16.1-rc.1

Esta es una corrección candidata de 0.16.0, no una publicación estable.
Objetivo: continuar sin confirmaciones repetidas y cerrar con evidencia real.
Probado aquí con OpenCode 2.0.20 y API @opencode/plugin 2.0.4.

Los checkpoints detienen herramientas nativas observadas después del bloqueo.
No son un sandbox de red ni cancelan efectos que ya estaban ejecutándose.
Code Mode global fetch queda fuera de esa garantía; no lo uses para evadir una
pausa. No se añade Review, otro juez ni una segunda autoridad de cierre.

## Instalar el candidato

Descomprime el ZIP. `andmar-ai/` contiene el repositorio completo versionado,
sin dependencias ni credenciales. Conserva tu checkout actual como respaldo.
El instalador protege instalaciones anteriores: no sobrescribe un agente
ni reemplaza un enlace que apunta a otro checkout. Para actualizar en Linux,
cierra OpenCode y respalda primero solamente esos dos elementos:

```bash
andmarConfig="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
andmarBackup="$andmarConfig/andmar-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$andmarBackup"
if [ -e "$andmarConfig/agents/andmar.md" ]; then
  mv "$andmarConfig/agents/andmar.md" "$andmarBackup/andmar.md"
fi
if [ -L "$andmarConfig/plugins/andmar-ai" ]; then
  mv "$andmarConfig/plugins/andmar-ai" "$andmarBackup/andmar-ai-link"
fi
```

Si plugins/andmar-ai es una carpeta real, conserva esa instalación y resuelve
la ubicación antes de instalar; no la borres ni la sobrescribas. Si tu agente
anterior tiene personalizaciones, consérvalas en el respaldo: esta aceptación
usa el agente oficial del candidato. En la carpeta extraída ejecuta:

```bash
bun install
bun run check
bun run install:dev
bun run doctor
```

`install:dev` enlaza esa carpeta: mantenla en una ubicación permanente.
Si usas OPENCODE_CONFIG_DIR personalizado, usa el mismo valor en instalación,
doctor y OpenCode. Comprueba `opencode --version` (validación de referencia:
2.0.20). Cierra/reabre OpenCode después de instalar para cargar el candidato.
No borres tu storage ni tus Ledgers. No hagas merge, tag, push o publicación
como parte de esta aceptación.

## Prueba 1 — versión, carga y regresiones

Abre OpenCode con el agente **andmar** en la carpeta del candidato. Pega:

> Verifica este candidato sin modificar su código. Ejecuta bun run check y
> bun run doctor. Comprueba que package.json y la versión runtime generada
> indican 0.16.1-rc.1. Reporta los resultados reales y la versión OpenCode.
> No publiques ni cambies la versión. Si falla algo, detente y registra el error.

PASS: check y doctor verdes; versión coherente. Engram ausente es opcional.
Las regresiones deterministas cubren touched/deduplicación/atribución, globs,
escape de workspace rechazado, lifecycle inválido/reopen, reglas de amendment,
respuesta antes/después de bind, legacy, sesiones separadas y trivial sin IO.

## Prueba 2 — preparación aislada

En otra sesión, pega:

> Prepara un repositorio Git temporal para pruebas de AndMar fuera de mis
> proyectos. Sin remotos ni push. Crea package.json con scripts test y typecheck
> que ejecuten Node y fallen si src/button.js no exporta label='Login'. Crea
> src/button.js con export const label = 'Login' y type:'module'. Haz un commit
> inicial local. No crees Work Ledger ni Task Contract. Indica la ruta para
> abrir ese repositorio en OpenCode.

Abre esa ruta en OpenCode. Todas las pruebas siguientes usan este repo.
El check de typecheck es un control mínimo de fixture, no un compilador real.

## Prueba 3 — fast path trivial

Pega:

> Cambia el texto Login por Entrar en src/button.js y ajusta las dos
> comprobaciones del fixture para esperar Entrar. No amplíes la tarea.

PASS: cambio correcto, verificación proporcional; sin Ledger/contrato nuevos,
amendment, planificación, checkpoint ni revisión. Comprueba el filesystem.

## Prueba 4 — trabajo normal, descubrimiento y scope

Pega en una sesión nueva del mismo repo:

> Prueba el flujo estructurado de AndMar sobre este fixture. El objetivo es
> añadir un segundo texto exportado helperText='Acceder a tu cuenta', comprobar
> ambos textos y documentarlos. Conserva label='Entrar'. Usa Intake, un Work
> Ledger lightweight con workId acceptance-normal y dos WU iniciales: WU-1
> implementar y comprobar; WU-2 documentar. Task Contract debe reflejar esas
> obligaciones. Declara Expected Files de WU-1 src/button.js y package.json.
> Vincula el Ledger antes de ejecutar. Durante WU-1 añade src/copy.js como
> descubrimiento necesario de bajo riesgo, dentro del objetivo, sin cambio
> material/decisión humana/restricción/obligación. Registra el descubrimiento
> con work_amend: withinGoal=true, risk=low, materialScope=false,
> humanDecision=false, hardToReverse=false, contradictsContract=false y
> changesObligation=false. No clasifiques esto como una excepción.
> Registra el scope descubierto en el Ledger después de observar su drift.
> Completa las WU pendientes, ejecuta los checks reales, registra receipts de
> la revisión exacta, verifica, satisface el contrato y cierra mediante Completion
> Gate y finalize. No commits obligatorios, push, publicación ni Review.
> Reporta touchedFiles y drift antes y después de ampliar el scope, evidencia
> de cada WU y el resultado final.

PASS: append de una WU, continuidad sin preguntas, src/copy.js aparece primero
como drift, luego queda cubierto por el scope actualizado; touched está
atribuido y deduplicado. Todos los checks y el gate pasan; Ledger completed.
El agente debe usar formatos/helpers existentes, no inventar estados.

## Prueba 5 — checkpoint real y bloqueo

Nueva sesión, pega:

> En este fixture inicia un Ledger lightweight acceptance-exception y vincúlalo.
> Objetivo: documentar los textos existentes en LOCAL-NOTES.md, sin cambiar la
> aplicación. Mantén un Task Contract coherente. Activa WU-1 y registra con
> work_amend un descubrimiento de alcance material que propone cambiar la
> interfaz pública del módulo: withinGoal=true, risk=high, materialScope=true,
> humanDecision=true, hardToReverse=false, contradictsContract=false y
> changesObligation=false. Esto es solo una prueba: NO implementes el cambio
> público. Una vez bloqueado, consulta status dos veces y lee WORK.md; intenta
> una escritura nativa inocua de MUST-NOT-EXIST.txt para probar el gate.
> Debe ser rechazada. No uses fetch, procesos externos ni helper resume shell
> para evadirlo. Detente esperando mi decisión y muestra blocker y checkpoint.

PASS: checkpointRequired=true, estado blocked, frontera durable en WORK.md;
status/read siguen disponibles y MUST-NOT-EXIST.txt no existe. No ejecución
posterior de producto. Si el agente declara rechazo, exige el resultado real
observado de la herramienta; una promesa no es PASS.

## Prueba 6 — reinicio y respuesta antes del bind

Cierra OpenCode por completo y vuelve a abrir el MISMO repo y sesión.
Pega este mensaje, que constituye la decisión humana posterior al checkpoint:

> Rechazo el cambio de interfaz pública. Limita el descubrimiento a documentar
> su evaluación, sin modificar el código público. La obligación original de
> LOCAL-NOTES.md sigue vigente. Vincula acceptance-exception con work_status,
> lee WORK.md y consulta status dos veces antes de work_resume. Resume una sola
> vez con mi decisión. Después intenta un segundo work_resume: debe devolver
> diagnóstico de que no hay WU bloqueada, sin pedir otra autorización.
> Ajusta el Ledger para reflejar la decisión sin borrar obligaciones. Ejecuta
> documentación y evaluación acotadas; prueba shell/edit nativos, checks reales,
> receipts, Verification, Task Contract, Completion Gate y finalize. No push.

PASS: el Ledger sobrevive, la respuesta anterior al bind se acepta, no hay
segunda confirmación, el duplicate resume no cambia estado, no cambia API;
trabajo y cierre completed. No reparación manual de WORK.md para desbloquear.
Si tu interfaz no permite reabrir la sesión, prueba una sesión nueva vinculada
al mismo Ledger y registra esa diferencia en el informe.

## Prueba 7 — receipts y frescura

Pega en una sesión nueva, sin Ledger bloqueado:

> Prueba Verification con herramientas nativas. Obtén la revisión real con
> working-state-revision.mjs del AndMar instalado. Ejecuta bun run test y
> bun run typecheck por separado y registra receipts con comando exacto en
> esa revisión. verify_revision con requiredChecks tests/typecheck debe pasar.
> Modifica un comentario en src/button.js, recalcula la revisión y verifica
> SIN rerun: debe rechazar evidencia vieja. Luego ejecuta y registra ambos
> checks de nuevo en la nueva revisión; debe pasar. Ejecuta también un comando
> Node que termine con error, e intenta registrarlo como passed=true:
> debe ser rechazado. No sustituyas resultados por booleanos manuales.

PASS: checks distintos conservan su evidencia; revisión nueva sin checks
rechazada; rerun aceptado; ejecución fallida nunca se convierte en éxito.

## Prueba 8 — hijos shell de Code Mode, si están expuestos

OpenCode 2.0.20 expone shell directo por defecto, no como hijo de execute.
No cambies la configuración productiva solamente para habilitar esta prueba.
Si tu configuración YA expone tools.shell dentro de Code Mode, pega:

> En un mismo execute ejecuta dos tools.shell con comandos distintos: bun run
> test y bun run typecheck. Usa sus resultados reales. Registra receipts para
> ambos sobre la revisión actual y verifica requiredChecks tests/typecheck.
> No envíes executionId. Repite el mismo comando con fallo y prueba que no
> pueda registrarse como passed=true. Reporta resultados y evidencia distinta.

PASS: ambos receipts almacenados, IDs internos distintos, fallo rechazado.
Si shell hijo no está expuesto, registra N/A por API nativa; las regresiones
compartidas de prueba 1 son obligatorias. Este candidato también fue probado
con exposición temporal de shell en el runtime real 2.0.20, sin cambiar defaults.

## Resultado y promoción

Pide al agente:

> Entrega una tabla por prueba: PASS/FAIL/N/A, resultado observado, ruta del
> Ledger cuando aplique y motivo. No marques PASS por haber intentado el paso.
> Registra versión OpenCode/modelo, errores, preguntas adicionales y si alguna
> herramienta requirió reparación manual o repetición de autorización.

Considera estable el **flujo operativo soportado** si pruebas 1–7 son PASS,
la 8 pasa cuando tu entorno la expone, no hay bloqueos sin salida, ni reparación
manual, ni confirmaciones repetidas, ni Review, y los Ledgers finalizan.
No declares garantía de sandbox universal, coste/token óptimo ni compatibilidad
con versiones que no has probado a partir de este set.

Solo después, en el repo del candidato, autoriza explícitamente promover:

> Las pruebas de aceptación pasaron. Promueve 0.16.1-rc.1 a 0.16.1: actualiza
> package.json, cambia su encabezado de CHANGELOG a 0.16.1 con fecha real y
> registra la aceptación local. Ejecuta bun run generate y bun run check.
> No cambies código ni publiques/taguees/empujes sin mi instrucción.

Si falla una prueba obligatoria, conserva RC, reporta el caso exacto y no
publiques. Para volver al harness anterior, cierra OpenCode, aparta el enlace/agente del
candidato y restaura los dos elementos respaldados en sus rutas originales;
reinicia OpenCode. No borres Ledgers/storage.
