'use strict';

const { validarTarjeta, TARJETA_APROBADA, TARJETA_RECHAZADA } = require('../../app/dominio/tarjeta');

const AHORA = new Date('2026-11-06T16:00:00.000Z');

const datosValidos = (cambios = {}) => ({
  numeroTarjeta: '4242 4242 4242 4242',
  titular: 'ANA PEREZ',
  vencimiento: '12/28',
  cvv: '123',
  ...cambios,
});

/** Devuelve el error lanzado o `null`, para poder inspeccionar el código y el campo. */
function capturar(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe('validarTarjeta (D14)', () => {
  test('la tarjeta 4242 se aprueba y devuelve los últimos 4 dígitos', () => {
    expect(validarTarjeta(datosValidos(), AHORA)).toEqual({
      resultado: 'aprobado',
      ultimosDigitos: '4242',
    });
  });

  test('la tarjeta 4000…0002 se rechaza', () => {
    expect(validarTarjeta(datosValidos({ numeroTarjeta: TARJETA_RECHAZADA }), AHORA)).toEqual({
      resultado: 'rechazado',
      ultimosDigitos: '0002',
    });
  });

  test('acepta el número sin espacios ni guiones', () => {
    expect(validarTarjeta(datosValidos({ numeroTarjeta: TARJETA_APROBADA }), AHORA).resultado).toBe(
      'aprobado'
    );
    expect(validarTarjeta(datosValidos({ numeroTarjeta: '4242-4242-4242-4242' }), AHORA).resultado).toBe(
      'aprobado'
    );
  });

  test.each([
    ['un número desconocido', { numeroTarjeta: '4111 1111 1111 1111' }, 'numeroTarjeta'],
    ['un número incompleto', { numeroTarjeta: '4242' }, 'numeroTarjeta'],
    ['sin número', { numeroTarjeta: '' }, 'numeroTarjeta'],
    ['un titular vacío', { titular: '  ' }, 'titular'],
    ['un titular con números', { titular: 'ANA 123' }, 'titular'],
    ['un vencimiento con formato raro', { vencimiento: '2030-12' }, 'vencimiento'],
    ['un vencimiento imposible', { vencimiento: '13/28' }, 'vencimiento'],
    ['un CVV de 2 dígitos', { cvv: '12' }, 'cvv'],
    ['un CVV de 4 dígitos', { cvv: '1234' }, 'cvv'],
    ['un CVV con letras', { cvv: '12a' }, 'cvv'],
  ])('rechaza %s con SOLICITUD_INVALIDA y el campo', (_, cambios, campo) => {
    const error = capturar(() => validarTarjeta(datosValidos(cambios), AHORA));
    expect(error).toMatchObject({
      codigo: 'SOLICITUD_INVALIDA',
      detalles: { campo },
    });
  });

  test('una tarjeta vencida se rechaza aunque el número sea de prueba (CA-27)', () => {
    const error = capturar(() => validarTarjeta(datosValidos({ vencimiento: '10/26' }), AHORA));
    expect(error).toMatchObject({
      codigo: 'SOLICITUD_INVALIDA',
      detalles: { campo: 'vencimiento' },
    });
  });

  test('la tarjeta sirve todo el mes de vencimiento', () => {
    const finDeNoviembre = new Date('2026-11-30T23:59:59.000Z');
    expect(validarTarjeta(datosValidos({ vencimiento: '11/26' }), finDeNoviembre).resultado).toBe(
      'aprobado'
    );
  });
});
