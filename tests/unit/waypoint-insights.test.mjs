import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWaypoint } from '../../viewer/waypoint-insights.js';

test('waypoint classification supports multiple categories with danger first', () => {
  const result = classifyWaypoint({
    name: '危险岔路',
    description: '落石区，附近有水源',
  });
  assert.equal(result.primary, 'danger');
  assert.equal(result.important, true);
  assert.deepEqual(result.categories.map((category) => category.key), ['danger', 'water', 'junction']);
  assert.deepEqual(result.categories[0].evidence, ['危险', '落石']);
  assert.equal(result.categories[0].confidence, 'high');
});

test('description-only matches are medium confidence', () => {
  const result = classifyWaypoint({ name: 'Waypoint', description: 'Spring water source' });
  assert.equal(result.primary, 'water');
  assert.equal(result.categories[0].confidence, 'medium');
  assert.ok(result.categories[0].evidence.includes('water source'));
});

test('category-specific negation prevents false positives', () => {
  const result = classifyWaypoint({
    name: 'Water source closed',
    description: 'No water. Camping prohibited. Danger cleared.',
  });
  assert.deepEqual(result.categories, []);
  assert.equal(result.important, false);
});

test('mixed positive and negative phrases keep only the valid category', () => {
  const result = classifyWaypoint({
    name: '草甸平台',
    description: '附近有水源，但禁止扎营',
  });
  assert.deepEqual(result.categories.map((category) => category.key), ['water']);
});

test('summit and junction labels remain available but are not important-only', () => {
  const junction = classifyWaypoint({ name: 'Yak pass junction' });
  assert.deepEqual(junction.categories.map((category) => category.key), ['junction', 'summit']);
  assert.equal(junction.important, false);
});

test('unrecognised waypoint text stays neutral', () => {
  const result = classifyWaypoint({ name: 'Photo stop', description: 'Two shots' });
  assert.equal(result.primary, null);
  assert.deepEqual(result.evidence, []);
});

test('icon hints classify a generic waypoint at medium confidence', () => {
  const result = classifyWaypoint({
    name: 'Waypoint',
    icon: 'https://example.test/icons/water-source.png',
  });
  assert.equal(result.primary, 'water');
  assert.equal(result.categories[0].confidence, 'medium');
  assert.deepEqual(result.categories[0].evidence, ['icon:water']);
});

test('route support categories are recognised independently', () => {
  const supply = classifyWaypoint({ name: '补给站', description: '商店可以补充食物' });
  const exit = classifyWaypoint({ name: '下撤口', description: '可以撤离到公路' });
  const rescue = classifyWaypoint({ name: '救援点', description: '应急求助点' });
  const crossing = classifyWaypoint({ name: '木桥', description: '仅限单人通过' });
  const viewpoint = classifyWaypoint({ name: '观景台', description: '拍照点' });
  assert.equal(supply.primary, 'supply');
  assert.equal(exit.primary, 'exit');
  assert.equal(rescue.primary, 'rescue');
  assert.equal(crossing.primary, 'crossing');
  assert.equal(viewpoint.primary, 'viewpoint');
});

test('full description sentences survive even when display text is truncated', () => {
  const long = `${'说明'.repeat(120)}前方禁止通行，请下撤。`;
  const result = classifyWaypoint({ name: '长文字提示', insightText: long, description: '说明…' });
  assert.equal(result.primary, 'danger');
  assert.ok(result.contexts.some((context) => context.includes('禁止通行')));
  assert.ok(result.evidence.includes('禁止通行'));
});
