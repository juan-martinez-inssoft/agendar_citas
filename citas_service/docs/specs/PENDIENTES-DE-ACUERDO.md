# Pendientes de acuerdo e implementación (L y D)

**Autor:** R (dominio de reservas) · **Fecha:** 9 nov 2026
**Origen:** `docs/specs/VERIFICACION-DOMINIO.md` (cotejo de CA-01 a CA-27 contra los repositorios).

Este archivo es la **bandeja de entrada** de lo que R detectó y no puede cerrar solo:

- R no edita `ACUERDOS.md` ni `TODOLIST.md` (regla del equipo).
- **L** decide lo que es contrato y lo registra en `ACUERDOS.md`.
- **D** decide lo que es repositorio o rutas y lo implementa.
- Cuando un punto se cierre, se marca ✅ aquí y se anota el commit o la fila de `ACUERDOS.md`.

Leyenda: ⬜ pendiente · 🔄 en curso · ✅ cerrado · ⏭️ descartado

---

## 1. Correcciones a la especificación (decide L, aplica R)

| # | Tema | Hoy | Propuesta de R | Qué cambia |
| --- | --- | --- | --- | --- |
| PA-01 | Orden de validación al apartar (D-03) | La spec valida el límite antes que la disponibilidad | Validar **disponibilidad antes que límite**: si un asiento está ocupado, `409` es más útil que contar asientos que no se podrán apartar | §3.2, pasos 4 y 5 |
| PA-02 | Liberar una reserva vencida (D-04) | CA-17 y §3.6 responden `410 RESERVA_VENCIDA` | Adoptar la **RN12 del backend**: liberar una vencida responde `204` y devuelve los asientos; el código ya trae el interruptor `permitirLiberarVencidas` | §3.6 y CA-17 |
| PA-03 | «Asientos de funciones distintas» (D-06) | RN03 y CA-05 hablan de funciones | Los asientos pertenecen al **recinto**, no a la función: reescribir como «asientos de otro recinto» y dejar el `400` real | §3.2, RN03 y CA-05 |

**Texto propuesto para `ACUERDOS.md`** (L puede copiarlo tal cual):

> **D15** (D-03) Al apartar se valida primero la disponibilidad y después el límite de 10. Si un asiento ya está ocupado, la respuesta es `409 ASIENTO_NO_DISPONIBLE` aunque la petición también supere el límite.
>
> **D16** (D-04) Liberar una reserva vencida está permitido (BCK RN12): responde `204` y devuelve los asientos que sigan tomados por esa reserva. Sólo una reserva pagada responde `409` y una ya liberada responde `410`.
>
> **D17** (D-06) Los asientos pertenecen al recinto, no a la función. La validación de RN03 es «todos los asientos son del recinto de la función»; los de otro recinto responden `400 SOLICITUD_INVALIDA`.

## 2. Cambios en `docs/specs/openapi.yaml` (L)

| # | Cambio | Dónde |
| --- | --- | --- |
| PA-04 | Reemplazar `resultadoSimulado` por `numeroTarjeta`, `titular`, `vencimiento` y `cvv` (D14) | líneas 278–292 y esquema de pago, línea 638 |
| PA-05 | `Boleto.codigo`: 12 caracteres sin prefijo, sin `0/O/1/I`, y quitar el ejemplo `BOL-7KQ2-M9XD-4TPA` | ejemplo del esquema `Boleto` |
| PA-06 | `Orden.numero`: ejemplo `ORD-000123` (hoy `ORD-2026-000123`) | ejemplo del esquema `Orden`, línea 695 |
| PA-07 | `detalles` de errores: `ASIENTO_NO_DISPONIBLE` con `asientos[]` + `asientoIds[]`, y `LIMITE_EXCEDIDO` con `maximo` (no `limite`) | esquema `Error` |

## 3. Cambios de repositorio y rutas (D)

| # | Tema | Qué falta | Dónde |
| --- | --- | --- | --- |
| PA-08 | Compra como invitado (P15) | `compradorId` nulo debe aceptarse cuando el sitio no exige comprador; el dominio ya omite el límite, pero el repo lo rechaza | `app/repos/memoria/reservas-repo-memoria.js:31` |
| PA-09 | Últimos 4 dígitos de la tarjeta (P19) | Guardar `ultimosDigitos` en el intento; hoy el dominio lo devuelve sólo en memoria | `ordenes-repo-memoria.js:29-34` y `reservas-repo-memoria.js:162-167` |
| PA-10 | Mapeo `ErrorRepositorio` → HTTP | Traducir `SOLICITUD_INVALIDA`→400, `NO_AUTENTICADO`→401, `NO_ENCONTRADO`→404, `ASIENTO_NO_DISPONIBLE`/`RESERVA_PAGADA`→409, `RESERVA_VENCIDA`/`RESERVA_LIBERADA`→410 y `LIMITE_EXCEDIDO`→422 | `app/app.js:39-51` |
| PA-11 | Rutas de negocio | Montar los 10 endpoints de la spec (menos `/auth`) sobre `ServicioReservas` | `app/app.js:34-36` |

> El servicio de dominio ya está listo y probado en `app/dominio/`: D sólo lo conecta, no reimplementa reglas.

## 4. Seguimiento

| # | Dueño | Estado |
| --- | --- | --- |
| PA-01 | L (acuerdo) + R (spec) | ⬜ |
| PA-02 | L (acuerdo) + R (spec) | ⬜ |
| PA-03 | L (acuerdo) + R (spec) | ⬜ |
| PA-04 a PA-07 | L | ⬜ |
| PA-08 a PA-11 | D | ⬜ |
| PA-12: `TODOLIST.md` sigue en «0/6» y con el esqueleto como pendiente | L | ⬜ |
