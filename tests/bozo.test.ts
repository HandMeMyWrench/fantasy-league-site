// Run: node --experimental-strip-types tests/bozo.test.ts
import assert from "node:assert"
import { emptyRound, currentVerdict, impliedProb, decimalOdds, parlay } from "@/lib/bozo"
import type { BozoVerdict } from "@/lib/bozo"

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log("  ✓", name)
}
const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

const V = (stage: "preview" | "final", bozoId: string): BozoVerdict => ({
  stage,
  bozoId,
  reason: "x".repeat(20),
  at: 1,
})

console.log("currentVerdict")
ok("final wins over preview", () => {
  const r = emptyRound("2026", 3)
  r.preview = V("preview", "a")
  r.final = V("final", "b")
  assert.strictEqual(currentVerdict(r)?.bozoId, "b")
})
ok("preview shows when no final", () => {
  const r = emptyRound("2026", 3)
  r.preview = V("preview", "a")
  assert.strictEqual(currentVerdict(r)?.bozoId, "a")
})
ok("none when neither", () => {
  assert.strictEqual(currentVerdict(emptyRound("2026", 3)), null)
})

console.log("odds math")
ok("impliedProb: -110 ≈ 0.5238", () => approx(impliedProb(-110), 110 / 210))
ok("impliedProb: +150 = 0.4", () => approx(impliedProb(150), 0.4))
ok("decimalOdds: -110 ≈ 1.909", () => approx(decimalOdds(-110), 1 + 100 / 110))
ok("decimalOdds: +150 = 2.5", () => approx(decimalOdds(150), 2.5))

console.log("parlay")
ok("no priced legs → null", () => {
  assert.strictEqual(parlay([null, undefined, 0]), null)
})
ok("single leg mirrors input", () => {
  const p = parlay([150])!
  assert.strictEqual(p.legs, 1)
  approx(p.decimal, 2.5)
  assert.strictEqual(p.american, 150)
})
ok("two +150 legs compound", () => {
  const p = parlay([150, 150, null])!
  assert.strictEqual(p.legs, 2)
  approx(p.decimal, 6.25)
  approx(p.prob, 0.16)
  assert.strictEqual(p.american, 525) // (6.25-1)*100
})
ok("favorite legs → negative-ish american", () => {
  const p = parlay([-200, -200])!
  approx(p.decimal, 2.25)
  assert.strictEqual(p.american, 125) // decimal>=2 → +125
})

console.log(`\n${n} assertions passed`)
