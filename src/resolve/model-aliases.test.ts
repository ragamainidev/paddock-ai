import { expect, test } from 'vitest';
import { catalogModelState, withCatalogModelAliases } from './model-aliases';

test('EPA spelling aliases cover curated RS wildcard patterns without widening unrelated patterns', () => {
  expect(catalogModelState('Audi', 'RS 7', ['RS7%'])).toBe('matched');
  expect(catalogModelState('Audi', 'RS 7 Sportback', ['RS7%'])).toBe('matched');
  expect(catalogModelState('Audi', 'RS 70', ['RS7%'])).toBe('contradicted');
  expect(withCatalogModelAliases({ make: 'Audi', models: ['RS7%'] }).models).toContain('RS 7 %');
  expect(withCatalogModelAliases({ make: 'Audi', models: ['R%'] }).models).toEqual(['R%']);
});
