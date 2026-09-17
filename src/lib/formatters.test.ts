import { describe, expect, test } from "vitest"
import { getTorrentProgress } from "./formatters"

describe("getTorrentProgress", () => {
  test("uses recheck progress while verifying", () => {
    expect(getTorrentProgress(2, 1, 0.42)).toBe(0.42)
  })

  test("normalizes string status values from RPC responses", () => {
    expect(getTorrentProgress("2" as unknown as number, 1, 0.42)).toBe(0.42)
  })

  test("does not show download completion when verification progress is absent", () => {
    expect(getTorrentProgress(2, 1)).toBe(0)
  })
})
