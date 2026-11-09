'use strict';

/**
 * Reloj del servicio (ADR-003, garantía 3).
 *
 * La regla de los 5 minutos y el cálculo de `vencida` dependen de `ahora`, nunca de
 * `Date.now()` dentro de la lógica. En producción se usa el reloj del sistema; en las
 * pruebas, un reloj fijo que se avanza a mano (RNF06).
 *
 * @typedef {{ ahora: () => Date, avanzarSegundos?: (s: number) => Date, fijar?: (f: Date) => Date }} Reloj
 */

/** Reloj real: devuelve una copia nueva para que nadie modifique su estado interno. */
function crearRelojSistema() {
  return {
    ahora: () => new Date(),
  };
}

/**
 * Reloj de prueba con el instante fijo. `avanzarSegundos` mueve el tiempo sin esperar.
 * @param {Date|string|number} [instante]
 */
function crearRelojFijo(instante = new Date()) {
  let actual = new Date(instante);
  if (Number.isNaN(actual.getTime())) throw new TypeError('El reloj necesita una fecha válida.');

  return {
    ahora: () => new Date(actual),
    avanzarSegundos(segundos) {
      if (typeof segundos !== 'number' || Number.isNaN(segundos)) {
        throw new TypeError('avanzarSegundos necesita un número.');
      }
      actual = new Date(actual.getTime() + segundos * 1000);
      return new Date(actual);
    },
    fijar(nuevoInstante) {
      const fecha = new Date(nuevoInstante);
      if (Number.isNaN(fecha.getTime())) throw new TypeError('fijar necesita una fecha válida.');
      actual = fecha;
      return new Date(actual);
    },
  };
}

module.exports = { crearRelojSistema, crearRelojFijo };
