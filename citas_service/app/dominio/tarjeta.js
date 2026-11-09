'use strict';

const { CODIGOS, ErrorRepositorio } = require('../repos/errores');

/**
 * Pago simulado (D14). Dos tarjetas de prueba deciden el resultado; cualquier otro
 * número es un error de la petición, no un rechazo del banco.
 */
const TARJETA_APROBADA = '4242424242424242';
const TARJETA_RECHAZADA = '4000000000000002';

const MENSAJE_TARJETA =
  'Usa una tarjeta de prueba: 4242 4242 4242 4242 o 4000 0000 0000 0002.';

const soloDigitos = (valor) => String(valor ?? '').replace(/\D/g, '');

function errorDeCampo(campo, mensaje) {
  return new ErrorRepositorio(CODIGOS.SOLICITUD_INVALIDA, mensaje, { campo });
}

/** `MM/AA` → mes y año de cuatro dígitos. Devuelve `null` si el formato no sirve. */
function leerVencimiento(valor) {
  const coincidencia = /^(0[1-9]|1[0-2])\/?(\d{2})$/.exec(String(valor ?? '').trim());
  if (!coincidencia) return null;
  return { mes: Number(coincidencia[1]), anio: 2000 + Number(coincidencia[2]) };
}

/**
 * Valida los datos de la tarjeta y decide el resultado (D14, CA-27).
 *
 * Lanza `SOLICITUD_INVALIDA` con `detalles.campo` si el formato no sirve o el número
 * no es de prueba; en ese caso no se registra ningún intento de pago.
 *
 * @param {{ numeroTarjeta?: string, titular?: string, vencimiento?: string, cvv?: string }} datos
 * @param {Date} [ahora] reloj del servicio, para rechazar tarjetas vencidas
 * @returns {{ resultado: 'aprobado'|'rechazado', ultimosDigitos: string }}
 */
function validarTarjeta({ numeroTarjeta, titular, vencimiento, cvv } = {}, ahora = new Date()) {
  const numero = soloDigitos(numeroTarjeta);
  if (numero !== TARJETA_APROBADA && numero !== TARJETA_RECHAZADA) {
    throw errorDeCampo('numeroTarjeta', MENSAJE_TARJETA);
  }

  const nombre = String(titular ?? '').trim();
  if (
    nombre.length < 3 ||
    nombre.length > 60 ||
    !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .-]+$/.test(nombre)
  ) {
    throw errorDeCampo('titular', 'Escribe el nombre del titular de la tarjeta.');
  }

  const partes = leerVencimiento(vencimiento);
  if (!partes) {
    throw errorDeCampo('vencimiento', 'Usa el formato MM/AA.');
  }
  // La tarjeta sirve hasta el último día del mes indicado.
  const primerDiaDelSiguienteMes = new Date(Date.UTC(partes.anio, partes.mes, 1));
  if (primerDiaDelSiguienteMes <= ahora) {
    throw errorDeCampo('vencimiento', 'La tarjeta está vencida.');
  }

  if (!/^\d{3}$/.test(String(cvv ?? '').trim())) {
    throw errorDeCampo('cvv', 'El CVV debe tener 3 dígitos.');
  }

  return {
    resultado: numero === TARJETA_APROBADA ? 'aprobado' : 'rechazado',
    ultimosDigitos: numero.slice(-4),
  };
}

module.exports = { validarTarjeta, TARJETA_APROBADA, TARJETA_RECHAZADA };
