import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localMinute,
  localCandidates,
  dayStart,
  addDays,
} from "../../dist/local-calendar.js";
test("calendar dates use the business timezone, including fractional offsets and local midnight", () => {
  assert.equal(
    localMinute("2026-10-22T19:00:00Z", "Asia/Kuala_Lumpur"),
    "2026-10-23T03:00",
  );
  assert.deepEqual(localCandidates("2026-10-22T10:30", "Asia/Kathmandu"), [
    "2026-10-22T04:45:00.000Z",
  ]);
  assert.equal(
    dayStart("2026-10-22", "Asia/Kuala_Lumpur"),
    "2026-10-21T16:00:00.000Z",
  );
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});
test("DST gaps are rejected and repeated wall times require an explicit instant choice", () => {
  assert.deepEqual(localCandidates("2026-03-08T02:30", "America/New_York"), []);
  assert.deepEqual(localCandidates("2026-11-01T01:30", "America/New_York"), [
    "2026-11-01T05:30:00.000Z",
    "2026-11-01T06:30:00.000Z",
  ]);
  assert.equal(
    dayStart("2026-03-08", "America/New_York"),
    "2026-03-08T05:00:00.000Z",
  );
  assert.equal(
    dayStart("2026-03-09", "America/New_York"),
    "2026-03-09T04:00:00.000Z",
  );
  assert.deepEqual(localCandidates("2026-02-30T10:00", "UTC"), []);
});
