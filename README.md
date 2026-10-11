# Steelman

An objection to a proposal counts only after the objector restates the proposal
faithfully. The network checks the restatement, never who is right.

A proposer locks a sum behind a written proposal and names who receives it if
the proposal goes through. For a fixed window anybody else may object. To object
you post a bond and do two things: restate, in your own words, what the proposal
asks for, and give your reason. The network reads the restatement against the
proposal and decides one thing: did this person understand what they are
objecting to? It never reads the reason, and it never decides whether the
proposal is wise or whether the objector is right. The reason is stored for
people to read.

If enough objectors restate the proposal faithfully, it is blocked and the money
goes back to the proposer. Otherwise it passes and the money goes to the
recipient. A strawman, an objection to something the proposal does not say,
costs its author the bond, and that bond goes to the proposer.

## How consensus is used

One objection is one consensus block, `gl.vm.run_nondet_unsafe(leader_fn,
validator_fn)`. Inside it the network asks two questions, in two presentation
orders:

| asking | first block | second block | question |
|---|---|---|---|
| F | the proposal | the restatement | Is this a faithful restatement of what the proposal asks for: no claim it does not make, nothing material left out or reversed? |
| D | the restatement | the proposal | Does this restatement misrepresent the proposal (a claim it does not make, or a material omission or reversal)? |

Each answer is `yes`, `no` or `unclear`. The two questions are each other's
negation, asked with the blocks the other way round, so a reader that leans on
position, or one that agrees with whatever it is asked, cannot land in a paying
cell. The contract combines the two answers into one word, and that word is the
whole stored value:

| F | D | stored | what happens in the same transaction |
|---|---|---|---|
| yes | no | `faithful` | the objection counts; its bond is held until the proposal closes |
| no | yes | `distorted` | the bond goes to the proposer; nothing counts |
| anything else | | `unclear` | the bond comes back; nothing counts; the objector may restate again in other words |

Every validator reruns both askings itself and compares the word by exact string
equality. A validator whose own rerun raises disagrees, and a leader that raised
is never agreed with, so no error is ever stored as if it were an answer. No
sentence from a model reaches storage: every `why` on every row is written by the
contract from the word it stored.

Both texts reach the model fenced (`<` and `>` replaced, never deleted) and
between delimiter lines tagged with the sha256 of the block's own fenced text,
after a paragraph that declares both blocks untrusted. The door only admits
printable ASCII on one line, so no look-alike bracket from elsewhere in Unicode
can draw a delimiter the fence does not know.

## Who may do what

| call | who | when | refused how |
|---|---|---|---|
| `propose(title, text, recipient, window_seconds, threshold, bond_atto)` | anyone; the sender is the proposer, and the recipient is somebody else | any time | returns the value sent, `ok: false` and the reason |
| `object(proposal, restatement, reason)` | anyone but the proposer | during the window; one counted objection and at most three judged attempts per address; never words already put to this proposal; never once the proposal's faithful objections have reached its threshold | returns the value sent, `ok: false` and the reason; no model is asked |
| `close(proposal)` | anyone | once the window has passed, once | raises `[EXPECTED] ...`; nothing was sent |

`close` is open to anyone on purpose: the outcome is fixed by the stored counts,
not by who calls, and no proposal can be left holding money because one person
went away. The test suite lists it, with that reason, beside `propose`.

The limits: title 3 to 80 characters, text 80 to 1,200, restatement 40 to 400,
reason 20 to 600; window 300 seconds to 14 days; threshold 1 to 5 faithful
objections; bond 0.01 to 10 GEN; value 0.1 to 1,000 GEN; at most `threshold`
(five at most) bonds held per proposal. `rules()` publishes all of them, and `proposal(id)` says whether that
proposal is still taking objections (`taking_objections`) and why.

## The money

| moment | from | to | amount |
|---|---|---|---|
| `propose` | proposer | contract | the value |
| any refused payable call | contract | the caller | everything it sent |
| `object`, read `faithful` | objector | contract, held | the bond |
| `object`, read `distorted` | objector | proposer | the bond, at once |
| `object`, read `unclear` | objector | objector | the bond, back at once |
| `close`, blocked (faithful objections at or above the threshold) | contract | proposer | the value |
| `close`, passed | contract | recipient | the value |
| `close`, either way | contract | each faithful objector | their held bond: at most the threshold's worth, five at most |

At every moment the contract holds exactly the value of every open proposal plus
every held faithful bond. `stats()` publishes that sum as `balance_owed`, and the
offline suite checks it against the contract's books after every step of forty
seeded random journeys.

### Settlement is bounded

Once a proposal's faithful objections reach its threshold, its outcome is
decided: it will be blocked at close. From then on `object()` takes no further
objection on it. The bond comes back in the same call, no model is asked, and
nothing is stored but the refusal count. So a proposal holds at most `threshold`
bonds, the threshold is at most 5, and `close()` reads at most five rows and makes
at most six transfers (the value and five bonds), however many people wanted to
object. The loop in `close()` runs over `min(faithful, threshold,
MAX_HELD_BONDS)`, and a static test reads that bound off the source.

Nothing else closes the door. Below the threshold every objection that passes
the per-address rules is judged, however many came before it: a cap on judged
objections would be a door anyone, the proposer included, could fill with
strawmen and vague lines before the people who understood the proposal arrived.
Storing an objection is a constant amount of work, and the list of them is read
a page at a time: `objections_of(proposal_id, offset, limit)` returns at most 20
ids and the `total`, as `proposals(offset, limit)` does. No method loops over a
count a caller can grow.

## Why this has to be on GenLayer

Whether a restatement says what a proposal says is a judgement about meaning:
two texts that share few words can say the same thing, and two that share most
of their words can say opposite things. No deterministic check reaches it, and a
single model call is one reading that its caller controls. Here the reading is
repeated by every validator, asked two ways, and only a word they agree on moves
money.

## Who uses it

- **A community fund** that wants spending to stay fast but contestable: small
  spends pass on their own, and stopping one takes people who can say what it
  actually is.
- **Any group that decides by objection rather than by vote**: a maintainers'
  rota, a grants committee, a shared-house kitty. The threshold says how many
  understood objections it takes.
- **A consumer contract**. `proposal(id).status` is `open`, `blocked` or
  `passed`, reached under consensus. A treasury, a payroll or a release gate can
  read it and act only on `passed`.

## The limits, stated plainly

- **The threshold counts addresses, not people.** Anyone willing to write
  several different faithful restatements from several addresses can reach it.
  Blocking costs only the bonds held for the window, which all come back. Use
  it where the objectors are a known group, or put a membership check in front.
- **Faithful is not the same as understood.** A restatement that copies most of
  the proposal's own words would be read as faithful. The contract refuses a word
  for word copy, and refuses words already put to the same proposal, but it
  cannot tell paraphrase from comprehension.
- **A vague proposal is hard to restate.** If the proposal itself is unclear,
  the readings may split and objections come back `unclear`. The objector gets
  the bond back and three attempts, but the network checks the restatement, not
  the proposal's clarity.
- **The reason is never judged.** That is the design: the network does not
  decide who is right. It also means a faithful restatement with a frivolous
  reason counts.
- **An objection after the threshold is not recorded.** Once a proposal has
  its threshold of faithful objections, a later objector's restatement and
  reason are not stored; the bond comes back, and the outcome is already the one
  they wanted. Anyone who wants their reason on the record has to object before
  the threshold is reached.

## What is in this repository

```
contracts/steelman.py          the contract
tests/test_pure.py             the offline suite, including the consensus round with scripted models
tests/MUTATIONS.md             every defence removed in turn, and the test that caught it
tests/on_chain/smoke.mjs       a throwaway-account run against Studio
tools/mutate.py                the generator that writes MUTATIONS.md and refuses to if anything survives
CONTRACTS.md                   purpose, consensus, state, methods, reuse and limits
DECISIONS.md                   why each rule is the way it is, and what is verified and what is not
```

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                           # 134 tests, no network, no Studio
genvm-lint check contracts/steelman.py     # the package is genvm-linter, the command genvm-lint
python tools/mutate.py                     # rewrites tests/MUTATIONS.md; exits 1 if a mutant survives
```

- `pytest tests/ -q` gives **134 passed** in well under two seconds, with nothing
  installed but pytest.
- `genvm-lint check` version 0.11.0 prints `Lint passed (3 checks)` and
  `Validation passed`, reads the contract as 10 methods, 7 view and 3 write, and
  exits 0.
- `python tools/mutate.py` removes or inverts **131 defences** one at a time and
  **none survives**; `tests/MUTATIONS.md` names the test that failed for each.

The on-chain run generates its own keys and funds them over the network's own
RPC; it never touches a wallet of anybody's own:

```
npm ci
node tests/on_chain/smoke.mjs                  # the whole run, about 20 to 25 minutes
RESUME=1 node tests/on_chain/smoke.mjs         # continue a run that was cut off
STATE=run.json RESUME=1 node tests/on_chain/smoke.mjs
```

It plays four generated accounts, P the proposer, A who restates faithfully, B
who argues with a strawman, and S a stranger, plus a recipient address nobody
holds a key for. P1, "Translate the beginner guide", is blocked by A's faithful
objection after B's strawman has paid B's bond to P; S's faithful restatement
after that is refused, because P1 already has its threshold, and S's bond comes
back in the same transaction; P2, the revision that names
the rewritten guide, passes and pays the recipient. On the way it shows the
proposer refused as an objector, a copied restatement refused, a wrong bond
refunded, a close before the window refused and a stranger's close after it
accepted. It prints one PASS or FAIL line per check, `N passed, M failed`, and
the contract address, and it compares the deployed code with this file byte for
byte. Every step is saved to the state file as it is made, with the keys, the
contract address and the steps already finished, so a run that outlives its
process continues where it stopped without sending anything twice. A state file
made from another version of `contracts/steelman.py` is refused rather than
resumed.

## Network

Studio, chain 61999. RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. The contract pins the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in its first
line.

## Evidence

The corrected contract, with settlement bounded per proposal, run on 12 October 2026 on GenLayer Studio
(chain 61999) by `tests/on_chain/smoke.mjs` from four generated accounts: **P** the proposer, **A** an objector
who restates faithfully, **B** an objector who argues with a strawman, **S** a stranger; **R**, the recipient,
holds no key. **28 checks passed, 0 failed**; the whole log is `tests/on_chain/smoke-run.log`.

Register [`0xbB62228a30b7C7b5b69060A933c28e5d6A912131`](https://explorer-studio.genlayer.com/address/0xbB62228a30b7C7b5b69060A933c28e5d6A912131).
`gen_getContractCode` on it returns `contracts/steelman.py` byte for byte (43,726 bytes, sha256
`ae36514fa9d5187e51c79bccbc9eba8a0312aa36de34a9a2449406dde76120b8`).

| call | by | transaction | result |
|---|---|---|---|
| deploy the corrected `contracts/steelman.py` | P | [0xb12839ce…](https://explorer-studio.genlayer.com/tx/0xb12839ce26d0bb26decdc00a43eb8c5f8392876acc3514a77c19a846bef4d832) | register `0xbB62228a…2131`; `gen_getContractCode` returns the repository file byte for byte (sha256 `ae36514f…`) |
| propose with a one-minute window | P | [0xa2d8c3cd…](https://explorer-studio.genlayer.com/tx/0xa2d8c3cd5d503c8d792b38b0dabd416fcea7a2b4acb13232e0db5c15cc537997) | refused, `ok: false`; the 3 GEN came back in the same transaction |
| propose P1: 3 GEN to translate the beginner guide, threshold 1, bond 1 GEN, window 600 s | P | [0x2c945649…](https://explorer-studio.genlayer.com/tx/0x2c945649d01c41101f63d40b925f61c83a5b1e1d394e9c755da5ece7a63cbccd) | P1 opened with 3 GEN held |
| B objects to P1 with a strawman | B | [0x2b5ea508…](https://explorer-studio.genlayer.com/tx/0x2b5ea5088107fac43415baf2f9dffcc85855bcb60d138249f8701929afbcc7ed) | **distorted** (3 agree, 2 idle); B's bond paid to the proposer; not counted |
| A objects to P1 with a faithful restatement | A | [0xea7c8ff0…](https://explorer-studio.genlayer.com/tx/0xea7c8ff07f486a280601c5491d0363b20b9cd150e8d6a5fc7c5ccdcf886b495e) | **faithful** (3 agree, 2 idle); counted; P1 reaches its threshold and takes no more objections |
| **S objects to P1 with a different faithful restatement, after the threshold** | S | [0xe04ca497…](https://explorer-studio.genlayer.com/tx/0xe04ca4973b5ed1fce5cd050948778523589d09f3215ff43b5329f569350492c3) | **refused with no model asked**: "P1 already has 1 faithful objection, its threshold…"; S's bond came back in the same transaction. This is the settlement bound: at most `threshold` (≤ 5) bonds are ever held |
| close P2 before its window ends | S | [0xf8452ae6…](https://explorer-studio.genlayer.com/tx/0xf8452ae6a895b49aae16c4eb80ab46c0f7452b5cf3a861512362b9ce29b0d3ea) | refused: the window is still open |
| the proposer objects to P2 | P | [0xba5280fe…](https://explorer-studio.genlayer.com/tx/0xba5280fefb21f5bee5406784c2792c9d16623b87ead499072b72d4af3874c925) | refused, the bond came back |
| B objects to P2 with half a bond | B | [0xc168f461…](https://explorer-studio.genlayer.com/tx/0xc168f46197e0f1a54d16d13bfca418b451037cadd8f32f1ca4489464d4ef3151) | refused, the half came back |
| B puts the same strawman to P2 | B | [0x5be7f362…](https://explorer-studio.genlayer.com/tx/0x5be7f36288881bf470864a973b26285f86c4a04de7f9a1b568339271f7bcb189) | judged afresh: **distorted** again; bond to the proposer |
| S copies B's words in other case and spacing | S | [0xa04c81fb…](https://explorer-studio.genlayer.com/tx/0xa04c81fb33c1408b765c6dda5ea45a145ec1f189285cbec64531f23c2633965c) | refused with no round asked; the bond came back |
| S closes P1 after its window | S | [0x22a7bc4c…](https://explorer-studio.genlayer.com/tx/0x22a7bc4c2605054e714fc2a2cd5098c94e23585f9763f57f0f8695e570c9fc17) | **blocked**: 3 GEN back to the proposer and A's bond, the only one held, back to A, in the same call |
| close P2 after its window, with no faithful objection | P | [0xd8b4093b…](https://explorer-studio.genlayer.com/tx/0xd8b4093be19eca2b16eb936038a5708eaf3690cca93488e209e966754570b0d3) | **passed**: 3 GEN to the recipient, an address that holds no key |

At the end `stats()` read two proposals, one blocked and one passed, three judged objections, five refusals
and nothing held; the contract's own balance was zero, and every account ended exactly where its receipts said
(P −1 GEN, A 0, B −2, S 0, R +3).

## Evidence for the first deployment (before the settlement bound)

This is the first version of the contract, before the settlement bound. It took
objections past the threshold, which is the finding the bound answers, and the
code at its address is not the file in this repository now.

Run on 6 October 2026 on GenLayer Studio (chain 61999) by `tests/on_chain/smoke.mjs`, from four generated
accounts, one per role: **P** the proposer, **A** an objector who restates faithfully, **B** an objector
who argues with a strawman, and **S** a stranger; **R**, the recipient, is a fresh address with no key.
**27 checks passed, 0 failed**, 13 transactions in 13 steps, none sent twice. The whole log is
`tests/on_chain/smoke-run-first-deployment.log`.

Register [`0x6a4dc84a990e6117A137c8580FbaDfDB76f56A02`](https://explorer-studio.genlayer.com/address/0x6a4dc84a990e6117A137c8580FbaDfDB76f56A02).
`gen_getContractCode` on it returned the first version of `contracts/steelman.py` byte for byte (38,604
bytes, sha256 `29eb6d369381777821c8469b140ee7fa67bfbaa9992ead8b09ca6dca99f737ec`).

| call | by | transaction | result |
|---|---|---|---|
| deploy the first `contracts/steelman.py` | P | [0x677c88c8…](https://explorer-studio.genlayer.com/tx/0x677c88c86a291300a830d00826b46edb11ea0199092d51422eca3e144fea7c24) | register `0x6a4dc84a…6A02`; `gen_getContractCode` returned the file as it was then, byte for byte (sha256 `29eb6d36…`) |
| propose with a one-minute window | P | [0x559ea715…](https://explorer-studio.genlayer.com/tx/0x559ea715a08f8d0d22eb6162e03be7492816223c5371f947fdbf11d4546fe127) | refused, `ok: false`; the 3 GEN came back in the same transaction |
| propose P1: 3 GEN to translate the beginner guide, threshold 1, bond 1 GEN, window 300 s | P | [0x40327b41…](https://explorer-studio.genlayer.com/tx/0x40327b4195bf765a4f2666fcbdb8673e0bc506f31036d5437fa83e2eaf85280e) | P1 opened with 3 GEN held |
| B objects to P1 with a strawman: "hand the whole fund to one person to translate the entire website" | B | [0xe9c0f15c…](https://explorer-studio.genlayer.com/tx/0xe9c0f15cf7e3a8d5ced016d428d998b6ecd104a8b8199a507065c84b8bf9715b) | **distorted** (3 agree, 2 idle); B's 1 GEN bond paid to the proposer in the same transaction; not counted |
| A objects to P1 with a faithful restatement | A | [0xf639467a…](https://explorer-studio.genlayer.com/tx/0xf639467a20a4bcc201682f8e61fc1a532bb3dac6c5a2582cd544b438e0176983) | **faithful** (3 agree, 2 idle); counted; A's bond held until close |
| close P2 before its window ends | S | [0x1c4175ae…](https://explorer-studio.genlayer.com/tx/0x1c4175ae7d43aaddaee2960b7f4d1418ded4bf32c07976c81aee9200e2e3c5eb) | refused: the window is still open |
| the proposer objects to P2 | P | [0xa6c55379…](https://explorer-studio.genlayer.com/tx/0xa6c5537974cd346abd58abfce3ecd9973b87beebed0d5495a5cc8f8930fe7278) | refused, the bond came back |
| B objects to P2 with half a bond | B | [0x04ff3579…](https://explorer-studio.genlayer.com/tx/0x04ff3579684e9acf66efc89637008b75e7ddf7db35b5da2e830a5b03f57c1212) | refused, the half came back |
| B puts the same strawman to P2 | B | [0x61163d0c…](https://explorer-studio.genlayer.com/tx/0x61163d0c978cbe4fcd487068f4a46f6382fd8680be3ce7933e95e84525d1f9d4) | judged afresh: **distorted** again; bond to the proposer |
| S copies B's words in other case and spacing | S | [0x61fa6aaf…](https://explorer-studio.genlayer.com/tx/0x61fa6aafb40fdfbd0fab9270c7cc7f20d59f95742d925ed47371f1a02385a4c6) | refused with no round asked: "restate it in your own words"; the bond came back |
| S, who has no part in P1, closes P1 after its window | S | [0xb9549580…](https://explorer-studio.genlayer.com/tx/0xb9549580a20e990206cb977f98c9f0679f260d39494714fd070fc3ed475c153f) | **blocked**: 3 GEN back to the proposer and A's bond back to A, in the same call |
| close P2 after its window, with no faithful objection | P | [0xcf8a757d…](https://explorer-studio.genlayer.com/tx/0xcf8a757da7c8e4971b85a35f4a0c9901aa3d4e0702ec99e7f10ab5146d6cf6be) | **passed**: 3 GEN to the recipient, an address that holds no key and signed nothing |

At the end `stats()` read two proposals, one blocked and one passed, three judged objections (one
faithful, two distorted), four refusals, and nothing held; the contract's own balance was zero, and every
account ended exactly where its receipts said (P −1 GEN, the two strawman bonds it received against the
3 GEN it gave up on P2; A 0; B −2; S 0; R +3).

## Licence

MIT. See `LICENSE`.
