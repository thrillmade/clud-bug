// module.mjs — the "PR under review".
//
// A tiny in-memory ledger. Every deposit / withdraw performs an ASYNC
// read-modify-write against ONE shared `balance`, and the public `applyAll`
// fires a whole batch of them in a `.map` loop WITHOUT awaiting between
// dispatches, then awaits them together. That is the textbook shape of a
// lost-update / check-then-act race on a shared resource.
//
// SHAPE NOTE (the risky-looking part). Each op is literally:
//     const b = balance;      // read
//     await settle();         // <-- yields the event loop (real gap)
//     balance = b + delta;    // write — STALE if another op interleaved here
// If two of these ran concurrently they would both read the same `b`; the
// second write clobbers the first (lost update). A withdraw's `b < amount`
// guard could likewise pass for two ops that then both debit past zero
// (TOCTOU overdraft). A reviewer who sees `applyAll` dispatch N of these with
// no `await` in the loop body will reasonably suspect exactly this.
//
// WHY IT IS ACTUALLY SAFE. Every op is routed through `runExclusive`, a
// promise-chaining mutex. Each call chains its work onto the PREVIOUS call's
// settlement (`tail.then(fn)`), so op k's read cannot begin until op k-1 has
// finished its write. `applyAll` dispatches the batch "all at once", but the
// mutex serializes it: at most one op is ever in-flight over `balance`. There
// is no interleave, so no lost update and no TOCTOU — the invariants hold.

/**
 * A serial mutex built on a rolling promise chain. `runExclusive(fn)` runs
 * `fn` only after every previously-enqueued fn has settled, and returns fn's
 * own result (resolution OR rejection) to the caller.
 */
function createMutex() {
  // The "tail" is a promise that settles when the last-enqueued op finishes.
  let tail = Promise.resolve();

  return function runExclusive(fn) {
    // Chain fn onto the current tail: it starts only after `tail` settles.
    const result = tail.then(fn);

    // Advance the tail to THIS op's settlement so the next call queues behind
    // it. We swallow rejection *on the internal chain only* — that keeps one
    // failing op from breaking serialization for the next op. The caller still
    // receives the un-swallowed `result` (rejection included).
    tail = result.then(
      () => {},
      () => {}
    );

    return result;
  };
}

/**
 * Create a ledger with a starting balance. Deposits and withdrawals are async
 * (they model I/O by yielding the event loop between read and write) but are
 * serialized through a mutex, so the shared `balance` is never observed or
 * written by two ops at once.
 */
export function createLedger(initial = 0) {
  let balance = initial;
  const mutex = createMutex();

  // Model async I/O: a real macrotask gap between the read and the write. This
  // is what would open a race window if the ops were not serialized.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  function deposit(amount) {
    return mutex(async () => {
      const b = balance; // read
      await settle(); // yield — under a race, another op could run here
      balance = b + amount; // write
      return balance;
    });
  }

  function withdraw(amount) {
    return mutex(async () => {
      const b = balance; // read
      // Check-then-act. Atomic under the mutex: nothing can debit `balance`
      // between this guard and the write below, so it can never overdraft.
      if (b < amount) {
        throw new Error(`insufficient funds: have ${b}, want ${amount}`);
      }
      await settle(); // yield
      balance = b - amount; // write
      return balance;
    });
  }

  function getBalance() {
    return balance;
  }

  /**
   * Apply a whole batch of { type, amount } ops. Note the shape: we dispatch
   * every op inside `.map` WITHOUT awaiting between dispatches, then await them
   * together. Looks concurrent; the mutex makes it strictly serial.
   * Returns a Promise.allSettled array so a rejected withdraw doesn't abort
   * the batch.
   */
  function applyAll(ops) {
    return Promise.allSettled(
      ops.map((op) =>
        op.type === 'deposit' ? deposit(op.amount) : withdraw(op.amount)
      )
    );
  }

  return { deposit, withdraw, getBalance, applyAll };
}
