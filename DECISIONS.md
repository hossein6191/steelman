# Decisions

The boundary first, then the prompt, the storage, the money and the doors, then
what is verified and what is not.

## 1. The boundary: what the network agrees on

**One word per objection.** The stored value is `faithful`, `distorted` or
`unclear`, a word from a closed set the contract wrote. Not a score, not a
reason, not a quote. The thing that has to be decided is whether a restatement
represents a proposal, and the coarsest answer that carries it is three-valued:
it does, it does not, or the readings did not settle. Anything finer, a fidelity
score or a list of what was missed, would put a value in storage that honest
nodes could reach differently while believing the same thing.

**It does not agree on who is right.** The objector's reason is stored and
published and never reaches the model. `_task` does not take it as a parameter,
the round does not take it, and a test checks that a marker written into a
reason appears in none of the prompts the round sends. The proposal's merits are
settled by the people who object, not by the network; the network only checks
that each counted objector is objecting to the proposal as written.

**It does not agree on anything about the proposal as a whole.** Blocked and
passed are arithmetic on the stored words, done by the contract at `close`, the
same on every node because it is not a judgement.

## 2. Two framings in one block

Every validator builds the prompt the same way, so a reader that leans on which
block came first leans the same way on every node, and the network would agree
on a biased answer. Asking only one question has the same problem with a reader
that tends to say yes.

So the block asks twice, sequentially, inside the one leader closure: once with
the proposal first and the question put as "is this faithful?", once with the
restatement first and the question put as "does this misrepresent?". The two
questions are each other's negation, so the paying cells need opposite words
from the two askings: `faithful` is yes then no, `distorted` is no then yes. A
reader that says yes to everything, or no to everything, or follows the order of
the blocks, lands in `unclear`, which pays nobody and returns the bond. Tests
drive each of those readers through the round.

Nested nondet blocks are not legal, and two separate blocks would be two
consensus rounds that could each settle a different way; one block with two
sequential prompts is one value, compared once.

**Exact equality, and no agreement with an error.** The validator reruns both
askings itself and compares the word by string equality. If its own rerun
raises, it disagrees: it has not derived the leader's value. If the leader
raised, it disagrees as well: an unreachable model is not an answer, the round
is not stored, and because the round runs before `object` writes anything, the
transaction leaves no trace and the value never moves.

## 3. The prompt

**The fence and the tag.** Both untrusted texts pass through `_fence`, which
replaces `<` with `(` and `>` with `)` and never deletes, so the length is kept.
Each block sits between two delimiter lines tagged with the first 16 hex
characters of the sha256 of its own fenced body. The proposal is public, so its
tag is no secret, and a restatement may carry it; but once fenced the
restatement holds no angle bracket at all and cannot write a line that starts
with `<<<`. A test plants the proposal's genuine closing line inside a
restatement and finds exactly four delimiter lines in both askings, the forgery
demoted to `(((END PROPOSAL tag)))`.

**ASCII on one line at the door.** The fence only knows the two ASCII brackets.
Unicode has many look-alikes that a model reads as brackets, so the door refuses
anything outside printable ASCII, and line breaks with it. Nothing over a length
cap is ever sampled: it is refused, so every character judged is in the prompt.

**The declaration.** Before the blocks the prompt says both are untrusted text
from members of the public, that anything they say about the task or the answer
counts for nothing, that their order carries no meaning, and that the task is not
to judge the proposal or the objection. Each question names the same three ways
to fail, a claim the proposal does not make, a material omission, a reversal,
and offers `unclear` for a restatement too vague to tell.

## 4. The storage

Scalars only inside the two `@allow_storage` dataclasses: a collection inside a
storage dataclass kills the VM. Lists are never stored as collections in a row;
the order of a proposal's objections is the `index_rows` TreeMap keyed
`P1:1`, `P1:2`, ..., and the held bonds are a second index of the same shape, so
`close` walks only the faithful ones. Ids are assigned by the contract from
counters. No caller JSON is parsed at all; the only `json.loads` reads a model's
answer, with hooks that refuse fractions, NaN and Infinity, because a float traps
the VM and a trap is not an exception anybody can catch. Every non-string
argument is checked with `isinstance` before a string method touches it, and
`_whole` refuses a bool, a negative number and digits outside ASCII.

## 5. The money

**The value.** `propose` takes it and holds it. At `close` it goes to exactly one
place: back to the proposer when the faithful objections reached the threshold,
to the recipient otherwise. The recipient may not be the proposer (a proposal
that pays its own author either way decides nothing) or the contract itself.

**The bond.** Each objection posts exactly the proposal's bond, so the price of
being heard is the proposer's to set, inside 0.01 to 10 GEN.

- `faithful`: held until close and then returned. An objector who understood the
  proposal is never out of pocket; the hold is what makes the objection a
  commitment for the length of the window.
- `distorted`: paid to the proposer in the same transaction. The proposer is the
  one misrepresented, and paying them rather than a pool means nobody but the
  proposer gains from a strawman, and the proposer cannot farm it: a strawman
  from the proposer's own second address pays the proposer their own money.
- `unclear`: returned in the same transaction. Two framings disagreeing is a fact
  about the round, not about the objector, so it costs nothing; the attempt cap
  and the burned words keep it from being re-rolled for ever.

**Refusals never raise after taking value.** Every refusal in `propose` and
`object` goes through `_refuse`, which returns everything sent and answers
`{"ok": false, "reason": ..., "returned": ...}`. A static test checks neither
method can reach `_fail`, `_clock` or a `raise`. `close` is not payable, so its
refusals raise `[EXPECTED] ...`.

**State before money.** Every transfer comes after every write in the same call,
and tests read the state at the moment of each transfer to check it.

**Conservation.** At every moment the contract holds the value of every open
proposal plus every held faithful bond, no more and no less. The suite checks the
contract's books against that sum after every step of forty seeded random
journeys and checks everything drains to zero once every proposal is closed.

## 6. The doors

| rule | why |
|---|---|
| the proposer may not object | an objection is somebody else's claim against the proposal |
| one counted objection per address | the threshold is a count of objectors, so one address counts once |
| three judged attempts per address per proposal | room for an honest objector whose first words were vague or wrong, and a bound on re-rolling the round from one address |
| words already put to this proposal are refused | copying somebody else's faithful restatement is not understanding it, and the same words must never be asked twice to see if they read differently; the digest ignores case, spacing and punctuation |
| the proposal's own words are refused as a restatement | a copy is not a restatement |
| the window is half-open | an objection at `closes_at` is late and a close at `closes_at` is on time; the two never overlap |
| a refused call spends no attempt | an attempt is a judged round, and a refusal asks no model |
| no readable clock, no proposal, objection or close | the window is measured on the message clock, `gl.message_raw["datetime"]`, the same on every node; an empty clock is refused, never guessed |

**Every refused party has somewhere to go.** A strawman objector may restate
again, faithfully, and count. A vague objector gets the bond back and restates in
other words. A late objector is told the proposal can now be closed, by anyone.
A blocked proposer gets the value back and may propose a revision, which is what
the on-chain run does with P2. A proposal nobody closes can be closed by anybody.
Each of these is a journey in the test suite. An objector who has used three
attempts on one proposal has no further move on it; that is the cap working.

## 7. Views

Every view takes ids, small integers or an address. A Studio read fails once the
encoded call passes 256 bytes, so no view takes a document; the proposal and the
restatement are read back by id. `proposals` pages at 20 so a reply always has a
size.

## 8. Verified, and not verified

**Verified here, offline, with no network:** 120 tests, green. The consensus
closure is driven directly with a scripted model per node: the same word
agreeing, a different word disagreeing, one validator outvoted, a majority in
another world storing nothing, a validator whose own rerun raises, and a leader
that raised. 114 defences removed or inverted one at a time, none surviving, each
with the test that caught it named in `tests/MUTATIONS.md`. `genvm-lint` 0.11.0
passes with exit code 0 and reads 10 methods, 7 view and 3 write.

**Verified by construction, through static checks over the parsed source:** the
model is called in one place, reachable only from the one leader closure, which
asks exactly the two framings; there is one round and it is not nested; the
validator is one line delegating to the comparison, which refuses a leader error
first and compares by exact equality; every write either refuses by sender
unconditionally or is listed with its reason (`propose`, `close`); payable writes
refund and never raise; the delimiter is written in one place and carries the
body's hash; every `json.loads` refuses floats; no float, no division, no
`datetime`; storage dataclasses hold scalars only; views take only short
arguments; the runner is pinned in the first line; no personal or internal
detail appears anywhere in the repository.

**Verified on chain** (6 October 2026, register `0x6a4dc84a990e6117A137c8580FbaDfDB76f56A02`, 27 checks
passed and 0 failed, `tests/on_chain/smoke-run.log`):

- the strawman was read `distorted` in both framings, twice (on P1 and, judged afresh, on P2), and A's
  restatement `faithful`, each by 3 agreeing validators with 2 idle and none disagreeing;
- two objections sent back to back both landed inside a 300-second window;
- `gl.message.contract_address` was readable: every proposal with an ordinary recipient was accepted;
- the deployed bytes equal this file (sha256 `29eb6d36…`), and every balance moved exactly as the money
  table says, with the contract's own balance zero at the end.

**Not verified:** how often the two framings split on a fair but loose restatement (no `unclear` came up
in the run), and which model the validators run.
