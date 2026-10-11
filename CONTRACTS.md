# Contracts

One file, `contracts/steelman.py`, class `Steelman`.

## Purpose

A proposal with money behind it that anybody may object to, where an objection
counts only once the objector has shown, under consensus, that they are objecting
to what the proposal actually says. The network checks the objector's
restatement of the proposal and nothing else. It never reads the objector's
reason and never decides who is right. Enough faithful objections block the
proposal and the money goes back to the proposer; otherwise it passes and the
money goes to the recipient. A strawman costs its author the bond, paid to the
proposer. Once a proposal has its threshold of faithful objections it takes no
more, so settling it is bounded: at most five held bonds and six transfers.

## Consensus

One round, `_restatement_round(title, text, restatement)`, one
`gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` block, run inside `object()`
before anything is written. The only `gl.nondet.exec_prompt` call in the file is
in `_ask`, and the only two `_ask` calls are inside that `leader_fn`. Nothing is
nested.

**The two askings.** `_task(title, text, restatement, framing)` builds both. The
framing fixes the order of the blocks and the question, and nothing else
differs:

- `FRAMING_FAITHFUL`: the PROPOSAL block, then the RESTATEMENT block. "Is this a
  faithful restatement of what the proposal asks for: no claim it does not make,
  nothing material left out or reversed?"
- `FRAMING_DISTORTED`: the RESTATEMENT block, then the PROPOSAL block. "Does this
  restatement misrepresent the proposal (a claim it does not make, or a material
  omission or reversal)?"

Each answer is read by `_read_answer` into `yes`, `no`, `unclear` or `""` (an
answer the contract cannot read). JSON from the model is parsed with hooks that
refuse fractions, NaN and Infinity, so no float is ever built.

**The combine rule.** `_combine(first, second)`: `yes` then `no` is `faithful`;
`no` then `yes` is `distorted`; anything else is `unclear`. The stored value is
that one word. A disagreement between the framings is a value, never a
tolerance, and it pays nobody.

**The comparison.** `validator_fn` is one line, `return _agrees(leaders_res,
leader_fn)`. `_agrees` returns `False` for a leader that raised, `False` for a
leader result that is not a dictionary, reruns the whole leader closure inside
`try/except` (its own failure is a disagreement), and compares `v` by exact
string equality.

**The prompt boundary.** `_block(label, text)` fences the text (`<` to `(`, `>`
to `)`, never deleted) and writes it between `<<<LABEL tag>>>` and `<<<END LABEL
tag>>>`, where `tag` is the first 16 hex characters of the sha256 of the fenced
body. It is the only place a delimiter is written. The labels are the two
contract constants `PROPOSAL` and `RESTATEMENT`. Before the blocks the prompt
says both are untrusted, that their order carries no meaning, and that the task
is not to judge who is right. The objector's reason is not a parameter of `_task`
or of the round.

## State

Two storage dataclasses of scalars only (a collection inside a storage dataclass
kills the VM):

| `Proposal` field | type | what it is |
|---|---|---|
| `proposer`, `recipient` | `Address` | who locked the value, and who receives it if the proposal passes |
| `title`, `text`, `text_digest` | `str` | the proposal as written, and the digest of its words |
| `value`, `bond` | `u256` | what is locked, and what each objection must post |
| `threshold`, `window` | `u32` | faithful objections that block it, and the window in seconds |
| `opened_at`, `closes_at` | `u64` | the message clock at `propose`, and when objections stop |
| `status` | `str` | `open`, `blocked` or `passed` |
| `faithful`, `distorted`, `unclear`, `judged` | `u32` | counts of judged objections |
| `held`, `fined` | `u256` | faithful bonds held now, and strawman bonds paid to the proposer |
| `closed_at`, `closed_by`, `paid_to` | `u64`, `Address`, `str` | the close, and whether the value went to the `proposer` or the `recipient` |

| `Objection` field | type | what it is |
|---|---|---|
| `proposal`, `objector`, `attempt` | `str`, `Address`, `u32` | which proposal, who, and which of their attempts |
| `restatement`, `reason`, `digest` | `str` | what was judged, what was not, and the digest of the restatement's words |
| `verdict` | `str` | `faithful`, `distorted` or `unclear`: the stored consensus value |
| `bond`, `held`, `to_proposer`, `returned` | `u256` | what was posted and where it went |
| `at`, `released_at` | `u64` | when it was judged, and when a held bond came back |

The contract itself holds `TreeMap[str, Proposal]` and `TreeMap[str, Objection]`
keyed by contract-assigned ids (`P1`, `P2`, ... and `O1`, `O2`, ...), five
`TreeMap[str, str]` indexes, and scalar counters:

| index | key | value |
|---|---|---|
| `index_rows` | `P1:3` | the id of the third judged objection to P1 |
| `held_rows` | `P1:2` | the id of the second faithful objection to P1, whose bond is held |
| `attempt_rows` | `P1:<address>` | judged attempts by that address on P1 |
| `counted_rows` | `P1:<address>` | that address's counted objection on P1 |
| `digest_rows` | `P1:<digest>` | the objection that already used those words on P1 |

`value_held + bonds_held` is what the contract owes, and it equals the
contract's balance after every call.

## Key methods

| method | kind | what it does |
|---|---|---|
| `propose(title, text, recipient, window_seconds, threshold, bond_atto)` | payable write | locks the value behind a new proposal; every refusal returns the value |
| `object(proposal, restatement, reason)` | payable write | checks the door with no model, then runs the round and settles the bond by the stored word; every refusal returns the value. Refuses, with no model asked, once the proposal's faithful objections have reached its threshold; below it, any number of objections is judged |
| `close(proposal)` | write | after the window: blocked or passed, the value to the proposer or the recipient, every held bond back, at most 1 + 5 transfers; refusals raise `[EXPECTED]` |
| `proposal(proposal_id)` | view | the whole proposal, with `status`, `window_open`, `closable`, `would_be`, `taking_objections` and `taking_objections_why`, and `max_held_bonds` (its threshold) |
| `objection(objection_id)` | view | one objection, with its restatement, its reason, the stored word and where the bond went |
| `objections_of(proposal_id, offset, limit)` | view | a page of at most 20 ids of the judged objections to one proposal, in the order judged, with `total` |
| `proposals(offset, limit)` | view | a page of at most 20 proposal summaries, oldest first |
| `standing(proposal_id, who)` | view | what one address may still do on one proposal: attempts used and left, its counted objection, whether it may object now |
| `stats()` | view | counts, `value_held`, `bonds_held`, `fined_total` and `balance_owed` |
| `rules()` | view | the askings, the combine table, what is compared, the money, the settlement bound, who may do what, and every limit, `max_held_bonds` among them |

Every view takes ids, small integers or an address, never free text: a Studio
read fails once the encoded call passes 256 bytes.

## Bounds

Settlement work per proposal has a ceiling, and so does every other loop.

| constant | value | what it bounds |
|---|---|---|
| `MAX_HELD_BONDS` | `MAX_THRESHOLD`, 5 | bonds held per proposal: `object()` takes no objection once the faithful ones reach the threshold, so `close()` reads at most 5 rows and makes at most 1 + 5 transfers |
| `PAGE_CAP` | 20 | rows per page of `proposals()` and of `objections_of()` |

`close()` loops over `held_count = min(faithful, threshold, MAX_HELD_BONDS)` and
refuses, whole, a state in which `held_count` differs from `faithful`, which
`object()` cannot write. The only other loops read the characters of one
argument once it is inside its length cap, or the parts of the message clock.
A static test fails on any loop outside those shapes.

The number of judged objections on a proposal is not capped. Storing one is a
constant amount of work (one row in each TreeMap), and the list is read a page
at a time. A cap would be a door anyone could fill with strawmen or vague
restatements from a handful of addresses, after which nobody could object.

## Reuse

`proposal(id).status` is the reusable answer: `passed` means the spend survived a
window in which anybody could have blocked it by showing they understood it.
Another contract reads it and acts only on `passed`; the recipient may itself be
a contract that does the work. The round is also reusable on its own:
`_restatement_round` answers "does this text represent that one" for any pair of
texts, with the disagreement of the two framings stored as `unclear` rather than
smoothed away, and could gate a reply, a review or a summary in the same way.

## Limits

- The threshold counts addresses, not people, and blocking costs only gas and
  the time the bonds are held.
- A near copy of the proposal reads as faithful; only an exact copy (by words)
  and words already used on the same proposal are refused.
- A vague proposal makes restatements hard to judge; the cost lands on the
  objector as `unclear` rounds, softened by the returned bond and three attempts.
- A Studio transaction's clock is the message `datetime`; a transaction with no
  readable clock is refused, never guessed.
- An objection after the threshold is refused, so its restatement and reason
  are not recorded; the outcome is already blocked.
