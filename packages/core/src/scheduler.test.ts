import { describe, test, expect } from "bun:test";
import { createCard, scheduleReview, getNextReviewDates } from "./scheduler.js";
import { CardState, Rating, type Card } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed reference time — makes all assertions deterministic */
const NOW = new Date("2026-01-15T12:00:00.000Z");

function makeCard(overrides: Partial<Card> = {}): Card {
  const base = createCard("note-uuid-1", "morph_form", "subst:sg:nom:m3");
  // Pin `due` to NOW so elapsed-day calculations in scheduleReview are
  // deterministic regardless of when the test suite runs. createEmptyCard()
  // (called inside createCard) sets due to real wall-clock time; overriding
  // it here ensures fixtures are fully time-independent.
  return { id: "card-uuid-1", ...base, due: NOW, ...overrides };
}

function makeMatureCard(): Card {
  return makeCard({
    state: CardState.Review,
    stability: 10,
    difficulty: 5,
    reps: 5,
    lapses: 0,
    scheduledDays: 10,
    elapsedDays: 10,
    // due = lastReview + scheduledDays = 2026-01-05 + 10d = 2026-01-15 = NOW
    due: NOW,
    lastReview: new Date("2026-01-05T12:00:00.000Z"),
  });
}

function makeRelearningCard(): Card {
  return makeCard({
    state: CardState.Relearning,
    stability: 2,
    difficulty: 7,
    reps: 3,
    lapses: 2,
    scheduledDays: 0,
    elapsedDays: 0,
    due: NOW,
    lastReview: new Date("2026-01-15T10:00:00.000Z"),
  });
}

// ---------------------------------------------------------------------------
// createCard
// ---------------------------------------------------------------------------

describe("createCard", () => {
  test("creates a New state card with zero reps and lapses", () => {
    const card = makeCard();
    expect(card.state).toBe(CardState.New);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
  });

  test("sets noteId and kind correctly", () => {
    const card = makeCard();
    expect(card.noteId).toBe("note-uuid-1");
    expect(card.kind).toBe("morph_form");
  });

  test("sets tag correctly", () => {
    const card = makeCard();
    expect(card.tag).toBe("subst:sg:nom:m3");
  });

  test("lastReview key is ABSENT on new card (not undefined)", () => {
    // exactOptionalPropertyTypes: the key must not exist at all, not be undefined
    const base = createCard("note-uuid-1", "morph_form");
    expect("lastReview" in base).toBe(false);
  });

  test("tag key is ABSENT when not provided", () => {
    const base = createCard("note-uuid-1", "gloss_forward");
    expect("tag" in base).toBe(false);
  });

  test("creates a basic_forward card without tag", () => {
    const base = createCard("note-uuid-2", "basic_forward");
    expect(base.kind).toBe("basic_forward");
    expect("tag" in base).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scheduleReview — new card
// ---------------------------------------------------------------------------

describe("scheduleReview — new card", () => {
  test("Again: state stays Learning", () => {
    const updated = scheduleReview(makeCard(), Rating.Again, NOW);
    expect(updated.state).toBe(CardState.Learning);
  });

  test("Again: due is in the future", () => {
    const updated = scheduleReview(makeCard(), Rating.Again, NOW);
    expect(updated.due.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("Again: due is within 1 hour (short relearn interval)", () => {
    const updated = scheduleReview(makeCard(), Rating.Again, NOW);
    const diffMs = updated.due.getTime() - NOW.getTime();
    expect(diffMs).toBeLessThan(60 * 60 * 1000);
  });

  test("Again: lapses stays 0 (no lapse on first Again from New)", () => {
    const updated = scheduleReview(makeCard(), Rating.Again, NOW);
    expect(updated.lapses).toBe(0);
  });

  test("Hard: state stays Learning", () => {
    const updated = scheduleReview(makeCard(), Rating.Hard, NOW);
    expect(updated.state).toBe(CardState.Learning);
  });

  test("Hard: due is in the future", () => {
    const updated = scheduleReview(makeCard(), Rating.Hard, NOW);
    expect(updated.due.getTime()).toBeGreaterThan(NOW.getTime());
  });

  test("Good: state stays Learning", () => {
    const updated = scheduleReview(makeCard(), Rating.Good, NOW);
    expect(updated.state).toBe(CardState.Learning);
  });

  test("Easy: state moves directly to Review", () => {
    const updated = scheduleReview(makeCard(), Rating.Easy, NOW);
    expect(updated.state).toBe(CardState.Review);
  });

  test("Easy: scheduledDays > 0", () => {
    const updated = scheduleReview(makeCard(), Rating.Easy, NOW);
    expect(updated.scheduledDays).toBeGreaterThan(0);
  });

  test("is a pure function — does not mutate input card", () => {
    const card = makeCard();
    const stateBefore = card.state;
    const repsBefore = card.reps;
    scheduleReview(card, Rating.Good, NOW);
    expect(card.state).toBe(stateBefore);
    expect(card.reps).toBe(repsBefore);
  });
});

// ---------------------------------------------------------------------------
// scheduleReview — mature Review card
// ---------------------------------------------------------------------------

describe("scheduleReview — mature Review card", () => {
  test("Again: state moves to Relearning", () => {
    const updated = scheduleReview(makeMatureCard(), Rating.Again, NOW);
    expect(updated.state).toBe(CardState.Relearning);
  });

  test("Again: lapses increments by 1 (regression guard for toFsrsCard/applyFsrsCard roundtrip)", () => {
    const card = makeMatureCard();
    const updated = scheduleReview(card, Rating.Again, NOW);
    expect(updated.lapses).toBe(card.lapses + 1);
  });

  test("Hard: state stays Review", () => {
    const updated = scheduleReview(makeMatureCard(), Rating.Hard, NOW);
    expect(updated.state).toBe(CardState.Review);
  });

  test("Hard: scheduledDays < Good scheduledDays", () => {
    const cardHard = scheduleReview(makeMatureCard(), Rating.Hard, NOW);
    const cardGood = scheduleReview(makeMatureCard(), Rating.Good, NOW);
    expect(cardHard.scheduledDays).toBeLessThan(cardGood.scheduledDays);
  });

  test("Good: state stays Review", () => {
    const updated = scheduleReview(makeMatureCard(), Rating.Good, NOW);
    expect(updated.state).toBe(CardState.Review);
  });

  test("Good: reps increments by 1", () => {
    const card = makeMatureCard();
    const updated = scheduleReview(card, Rating.Good, NOW);
    expect(updated.reps).toBe(card.reps + 1);
  });

  test("Good: scheduledDays increases", () => {
    const card = makeMatureCard();
    const updated = scheduleReview(card, Rating.Good, NOW);
    expect(updated.scheduledDays).toBeGreaterThan(card.scheduledDays);
  });

  test("Easy: state stays Review", () => {
    const updated = scheduleReview(makeMatureCard(), Rating.Easy, NOW);
    expect(updated.state).toBe(CardState.Review);
  });

  test("Easy: scheduledDays > Good scheduledDays", () => {
    const cardGood = scheduleReview(makeMatureCard(), Rating.Good, NOW);
    const cardEasy = scheduleReview(makeMatureCard(), Rating.Easy, NOW);
    expect(cardEasy.scheduledDays).toBeGreaterThan(cardGood.scheduledDays);
  });

  test("any rating: lastReview is set to NOW", () => {
    for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      const updated = scheduleReview(makeMatureCard(), rating, NOW);
      expect(updated.lastReview).toEqual(NOW);
    }
  });

  test("is a pure function — does not mutate input card", () => {
    const card = makeMatureCard();
    const lapsesBefore = card.lapses;
    scheduleReview(card, Rating.Again, NOW);
    expect(card.lapses).toBe(lapsesBefore);
  });
});

// ---------------------------------------------------------------------------
// scheduleReview — Relearning card
// ---------------------------------------------------------------------------

describe("scheduleReview — Relearning card", () => {
  test("Again: state stays Relearning", () => {
    const updated = scheduleReview(makeRelearningCard(), Rating.Again, NOW);
    expect(updated.state).toBe(CardState.Relearning);
  });

  test("Good: state moves back to Review", () => {
    const updated = scheduleReview(makeRelearningCard(), Rating.Good, NOW);
    expect(updated.state).toBe(CardState.Review);
  });
});

// ---------------------------------------------------------------------------
// getNextReviewDates
// ---------------------------------------------------------------------------

describe("getNextReviewDates", () => {
  test("returns Date objects for all four ratings", () => {
    const dates = getNextReviewDates(makeCard(), NOW);
    expect(dates[Rating.Again]).toBeInstanceOf(Date);
    expect(dates[Rating.Hard]).toBeInstanceOf(Date);
    expect(dates[Rating.Good]).toBeInstanceOf(Date);
    expect(dates[Rating.Easy]).toBeInstanceOf(Date);
  });

  test("ordering: Again ≤ Hard ≤ Good ≤ Easy for new card", () => {
    const dates = getNextReviewDates(makeCard(), NOW);
    expect(dates[Rating.Again].getTime()).toBeLessThanOrEqual(dates[Rating.Hard].getTime());
    expect(dates[Rating.Hard].getTime()).toBeLessThanOrEqual(dates[Rating.Good].getTime());
    expect(dates[Rating.Good].getTime()).toBeLessThanOrEqual(dates[Rating.Easy].getTime());
  });

  test("ordering: Again < Good < Easy for mature card", () => {
    const dates = getNextReviewDates(makeMatureCard(), NOW);
    expect(dates[Rating.Again].getTime()).toBeLessThan(dates[Rating.Good].getTime());
    expect(dates[Rating.Good].getTime()).toBeLessThan(dates[Rating.Easy].getTime());
  });

  test("all dates are in the future relative to NOW", () => {
    const dates = getNextReviewDates(makeCard(), NOW);
    for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
      expect(dates[rating].getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  test("is a pure function — does not mutate input card", () => {
    const card = makeCard();
    const stateBefore = card.state;
    const repsBefore = card.reps;
    getNextReviewDates(card, NOW);
    expect(card.state).toBe(stateBefore);
    expect(card.reps).toBe(repsBefore);
  });
});
