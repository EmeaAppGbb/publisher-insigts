import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PRODUCTION_LINE, REPRINT_LIMIT_GBP, STANDARD_MANAGER_LIMIT_GBP, approvingRole, requiredApprover, seniorTo,
} from '../src/authority.ts'
import { thousands } from '../src/requests.ts'

const [manager, head, publishing, managing] = PRODUCTION_LINE.map((approver) => approver.role)
const name = (expedited: boolean, investmentGbp: number) => requiredApprover({ expedited, investmentGbp }).name

test('every reprint row of BKS-GOV-003 §1 names its approver, at each boundary', () => {
  assert.equal(name(false, 1), 'Production planning manager')
  assert.equal(name(false, 50_000), 'Production planning manager')
  assert.equal(name(false, 50_001), 'Head of production planning')
  assert.equal(name(false, 67_200), 'Head of production planning')
  assert.equal(name(false, 150_000), 'Head of production planning')
  assert.equal(name(true, 1), 'Publishing director')
  assert.equal(name(true, 50_000), 'Publishing director')
  assert.equal(name(true, 150_000), 'Publishing director')
  assert.equal(name(true, 150_001), 'Managing director')
  assert.equal(name(false, 150_001), 'Managing director')
})

test('the required approver or anyone more senior in the production line approves, and records the lowest role held', () => {
  const expedite = requiredApprover({ expedited: true, investmentGbp: 50_000 })
  assert.equal(approvingRole([publishing], expedite)?.name, 'Publishing director')
  assert.equal(approvingRole([managing], expedite)?.name, 'Managing director')
  assert.equal(approvingRole([managing, publishing], expedite)?.name, 'Publishing director')
  assert.equal(approvingRole([manager, head], expedite), undefined)
  assert.equal(approvingRole([], expedite), undefined)
  assert.equal(approvingRole(['Reprint.Approver', 'reprint.publishingdirector', 'PublishingDirector'], expedite), undefined)

  const standard = requiredApprover({ expedited: false, investmentGbp: 67_200 })
  assert.equal(approvingRole([manager], standard), undefined)
  assert.deepEqual([head, publishing, managing].map((role) => approvingRole([role], standard)?.role), [head, publishing, managing])

  const small = requiredApprover({ expedited: false, investmentGbp: 50_000 })
  assert.deepEqual(PRODUCTION_LINE.map((approver) => approvingRole([approver.role], small)?.role), [manager, head, publishing, managing])

  const large = requiredApprover({ expedited: false, investmentGbp: 180_000 })
  assert.equal(approvingRole([manager, head, publishing], large), undefined)
  assert.equal(approvingRole([managing], large)?.role, managing)
  assert.deepEqual(seniorTo(large), [])
  assert.deepEqual(seniorTo(expedite).map((approver) => approver.name), ['Managing director'])
})

// The governed document is the source of the thresholds and the approvers' names: a change to either fails here.
test("the server's matrix is the one BKS-GOV-003 states", () => {
  const document = readFileSync(new URL('../../../knowledge/bks-gov-003-decision-authority-matrix-v1.md', import.meta.url), 'utf8')
  const pounds = (value: string) => Number(value.replace(/[£,]/g, ''))
  const rows = [...document.matchAll(/^\| (Standard reprint|Expedited reprint|Any reprint) \| (.+?) \| (.+?) \|$/gm)]
  assert.equal(rows.length, 4, 'four reprint rows in §1')
  for (const [, decision, investment, approver] of rows) {
    const kinds = decision === 'Any reprint' ? [false, true] : [decision === 'Expedited reprint']
    const upTo = /^Up to (£[\d,]+)$/.exec(investment)
    const between = /^(£[\d,]+) to (£[\d,]+)$/.exec(investment)
    const over = /^Over (£[\d,]+)$/.exec(investment)
    const amounts = upTo ? [1, pounds(upTo[1])] : between ? [pounds(between[1]), pounds(between[2])] : over ? [pounds(over[1]) + 1] : []
    assert.ok(amounts.length, `${decision}: ${investment}`)
    for (const expedited of kinds) {
      for (const amount of amounts) assert.equal(name(expedited, amount), approver, `${decision} at £${amount}`)
    }
  }
  assert.ok(document.includes(`| Standard reprint | Up to £${thousands(STANDARD_MANAGER_LIMIT_GBP)} |`))
  assert.ok(document.includes(`| Any reprint | Over £${thousands(REPRINT_LIMIT_GBP)} |`))
  const line = /The production line runs ([^;]+);/.exec(document)?.[1]
  assert.deepEqual(line?.split(', '), PRODUCTION_LINE.map((approver) => approver.name.toLowerCase()))
  assert.match(document, /A more senior approver in the same line may approve instead\./)
})
