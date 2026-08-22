import assert from 'node:assert/strict'
import { cpuUsage } from 'node:process'
import { createAdaptiveDelay } from '../dist/index.mjs'

const WARMUP_RECORDS = 50_000
const MEASURED_RECORDS = 5_000_000
const RECORD_BUDGET_MICROSECONDS = 25

let now = 0
const delay = createAdaptiveDelay({
  clock: () => {
    now += 50
    return now
  },
})

for (let index = 0; index < WARMUP_RECORDS; index += 1) {
  delay.record()
}

const startedUsage = cpuUsage()
for (let index = 0; index < MEASURED_RECORDS; index += 1) {
  delay.record()
}
const measuredUsage = cpuUsage(startedUsage)
const averageMicroseconds = (measuredUsage.user + measuredUsage.system) / MEASURED_RECORDS

assert.ok(Number.isFinite(delay.getDelay()), 'The measured adaptive delay must remain usable.')
console.log(
  `AdaptiveDelay.record(): ${averageMicroseconds.toFixed(3)} us average ` +
    `(${MEASURED_RECORDS.toLocaleString('en-US')} records; ${RECORD_BUDGET_MICROSECONDS} us budget).`,
)

if (averageMicroseconds > RECORD_BUDGET_MICROSECONDS) {
  throw new Error(
    `AdaptiveDelay.record() exceeded the ${RECORD_BUDGET_MICROSECONDS} us average CPU budget.`,
  )
}
