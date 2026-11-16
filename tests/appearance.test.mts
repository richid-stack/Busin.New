import assert from 'node:assert/strict'
import { appearanceAttributes, DEFAULT_APPEARANCE, parseAppearance } from '../src/utils/appearance.ts'

assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE)
assert.deepEqual(parseAppearance('not json'), DEFAULT_APPEARANCE)
assert.deepEqual(parseAppearance(JSON.stringify({ accent: 'violet', text: 'large', width: 'wide', motion: 'reduced' })), { accent: 'violet', text: 'large', width: 'wide', motion: 'reduced' })
// One bad value falls back alone; the rest is kept.
assert.deepEqual(parseAppearance({ accent: 'hotpink', text: 'large', width: 5, motion: 'full' }), { accent: 'blue', text: 'large', width: 'standard', motion: 'full' })
// Defaults leave every attribute off.
assert.deepEqual(appearanceAttributes(DEFAULT_APPEARANCE), { 'data-accent': null, 'data-text': null, 'data-width': null, 'data-motion': null })
assert.equal(appearanceAttributes({ ...DEFAULT_APPEARANCE, accent: 'rose' })['data-accent'], 'rose')
console.log('appearance: all passed')
