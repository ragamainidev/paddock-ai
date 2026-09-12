import { describe, expect, test } from 'vitest';
import {
  normalizeAspiration,
  normalizeBlock,
  normalizeDrive,
  normalizeFuel,
  parseLiters,
  toInt,
} from './normalize';

// Input values below are verbatim from the source CSV's actual value domains.

describe('normalizeAspiration', () => {
  test('maps naturally aspirated', () => {
    expect(normalizeAspiration('Naturally Aspirated')).toBe('NA');
  });
  test('maps all turbo variants to Turbo', () => {
    expect(normalizeAspiration('Turbocharged')).toBe('Turbo');
    expect(normalizeAspiration('Turbo/Aftercooled')).toBe('Turbo');
    expect(normalizeAspiration('Turbo/Aftercooled/Intercooled')).toBe('Turbo');
    expect(normalizeAspiration('Turbo/Intercooled')).toBe('Turbo');
  });
  test('maps supercharged and twincharged', () => {
    expect(normalizeAspiration('Supercharged')).toBe('Supercharged');
    expect(normalizeAspiration('Turbo/Supercharged')).toBe('Twincharged');
  });
  test('unknown markers become null', () => {
    expect(normalizeAspiration('N/A')).toBeNull();
    expect(normalizeAspiration('-')).toBeNull();
    expect(normalizeAspiration('')).toBeNull();
  });
});

describe('normalizeDrive', () => {
  test('passes through the four canonical values', () => {
    expect(normalizeDrive('RWD')).toBe('RWD');
    expect(normalizeDrive('FWD')).toBe('FWD');
    expect(normalizeDrive('AWD')).toBe('AWD');
    expect(normalizeDrive('4WD')).toBe('4WD');
  });
  test('maps light-truck axle notation', () => {
    expect(normalizeDrive('4 X 4')).toBe('4WD');
    expect(normalizeDrive('4 X 2')).toBe('RWD');
  });
  test('commercial-truck axle formats become null', () => {
    expect(normalizeDrive('6 X 4')).toBeNull();
    expect(normalizeDrive('10 X 6')).toBeNull();
    expect(normalizeDrive('U/K')).toBeNull();
  });
});

describe('normalizeFuel', () => {
  test('passes through core fuels', () => {
    expect(normalizeFuel('GAS')).toBe('GAS');
    expect(normalizeFuel('DIESEL')).toBe('DIESEL');
    expect(normalizeFuel('FLEX')).toBe('FLEX');
  });
  test('maps hybrid families to HYBRID', () => {
    expect(normalizeFuel('FULL HYBRID EV-GAS (FHEV)')).toBe('HYBRID');
    expect(normalizeFuel('MILD HYBRID EV-GAS (MHEV)')).toBe('HYBRID');
    expect(normalizeFuel('PLUG-IN HYBRID EV-GAS (PHEV)')).toBe('HYBRID');
    expect(normalizeFuel('ELECTRIC/DIESEL')).toBe('HYBRID');
  });
  test('maps EV families to ELECTRIC', () => {
    expect(normalizeFuel('BATTERY EV (EV/BEV)')).toBe('ELECTRIC');
    expect(normalizeFuel('ELECTRIC')).toBe('ELECTRIC');
    expect(normalizeFuel('FUEL CELL EV (FCEV)')).toBe('ELECTRIC');
  });
  test('biodiesel counts as diesel; gaseous fuels are null', () => {
    expect(normalizeFuel('BIODIESEL')).toBe('DIESEL');
    expect(normalizeFuel('CNG')).toBeNull();
    expect(normalizeFuel('LPG')).toBeNull();
    expect(normalizeFuel('U/K')).toBeNull();
  });
});

describe('normalizeBlock', () => {
  test('keeps real block layouts', () => {
    expect(normalizeBlock('L')).toBe('L');
    expect(normalizeBlock('V')).toBe('V');
    expect(normalizeBlock('H')).toBe('H');
    expect(normalizeBlock('W')).toBe('W');
    expect(normalizeBlock('R')).toBe('R');
  });
  test('unknown markers become null', () => {
    expect(normalizeBlock('-')).toBeNull();
    expect(normalizeBlock('U/K')).toBeNull();
  });
});

describe('toInt', () => {
  test('parses digit strings', () => {
    expect(toInt('6')).toBe(6);
    expect(toInt('2026')).toBe(2026);
  });
  test('rejects non-numeric markers', () => {
    expect(toInt('U/K')).toBeNull();
    expect(toInt('-')).toBeNull();
    expect(toInt('')).toBeNull();
  });
});

describe('parseLiters', () => {
  test('parses liter display strings', () => {
    expect(parseLiters('3.6L')).toBe(3.6);
    expect(parseLiters('5.0L')).toBe(5.0);
  });
  test('rejects missing values', () => {
    expect(parseLiters('N/A')).toBeNull();
    expect(parseLiters('')).toBeNull();
    expect(parseLiters('-')).toBeNull();
  });
});
