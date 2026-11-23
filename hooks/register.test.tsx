import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cache-timer',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const T0 = 1_000_000_000_000
const usage = (m5: number, h1: number) => ({
  input_tokens: 10, output_tokens: 10,
  cache_read_input_tokens: 5000, cache_creation_input_tokens: m5 + h1,
  ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1, model: 'x',
})

const engine = { usage: {} as object }
function stubStep(on: any) {
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: engine.usage }
  })
}
async function stepAt($: any, u: object) {
  engine.usage = u
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1 })) { /* drain */ }
}

test('no request yet, then warm with time left, warning, then cold', async ($, on) => {
  const now = { t: T0 }
  on('clock.now', () => ({ value: now.t }))
  stubStep(on)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /no cached request/ }))?.text).toBe('Cache: no cached request yet')
  await ui.unmount()

  await stepAt($, usage(0, 3000))

  now.t = T0 + 10 * 60_000
  const term = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /left/ }))?.text).toContain('50:00 left')
  await term.unmount()

  now.t = T0 + 57 * 60_000
  const desk = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await desk.find({ type: 'Text', text: /going cold/ }))?.text).toContain('going cold soon')
  await desk.unmount()

  now.t = T0 + 63 * 60_000
  const phone = await $.ui.mount({ ...BAND, surface: 'mobile' })
  expect((await phone.find({ type: 'Text', text: /COLD/ }))?.text).toBe('● Cache COLD')
  expect((await phone.find({ type: 'Text', text: /expired/ }))?.text).toContain('expired 3:00 ago')
  await phone.unmount()
})

test('a 5m write shows the shorter lifetime', async ($, on) => {
  const now = { t: T0 }
  on('clock.now', () => ({ value: now.t }))
  stubStep(on)
  await stepAt($, usage(2000, 0))
  now.t = T0 + 60_000
  const ui = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect((await ui.find({ type: 'Text', text: /left/ }))?.text).toContain('4:00 left')
  await ui.unmount()
})
