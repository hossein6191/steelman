/* Steelman against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copy.
 *
 *   npm ci                                                  # genlayer-js 1.1.8 and viem 2.56.8
 *   node tests/on_chain/smoke.mjs                           # the whole run, from a fresh state
 *   RESUME=1 node tests/on_chain/smoke.mjs                  # continue a run that was cut off
 *   STATE=/some/dir/run.json RESUME=1 node tests/on_chain/smoke.mjs   # the same, with the state kept elsewhere
 *
 * Four generated accounts play the story: P proposes, A objects with a faithful restatement, B
 * objects with a strawman, and S is a stranger with no part in either proposal. The recipient R is
 * a fresh address nobody holds a key for; it only ever receives.
 *
 *   1  deploy; a proposal with a one-minute window is refused and its 3 GEN come back.
 *   2  P1 "Translate the beginner guide": 3 GEN, threshold 1, bond 1 GEN, window 300 s. B's strawman
 *      and A's faithful restatement are sent back to back, so both are judged inside the window.
 *      The strawman is read as distorted and B's bond goes to P at once; A's restatement is read
 *      as faithful, counts, and A's bond is held.
 *   3  P2, the revised proposal (the rewritten guide), window 900 s. Refusals that ask no model:
 *      a close before the window, the proposer objecting, a wrong bond. B's strawman, put to P2,
 *      is distorted again; S copies it in other case and spacing and is refused.
 *   4  S closes P1 after its window: blocked, the 3 GEN go back to P and A's bond to A.
 *   5  P2's window runs out with no faithful objection; it is closed: passed, 3 GEN to R.
 *   6  the views read back, the deployed code compared with the file byte for byte, the contract's
 *      balance read, and every account's net movement checked against what the receipts say.
 *
 * Every refusal is a signed transaction. Balances are read after finalisation, because a transfer
 * lands at FINALIZED, not at ACCEPTED. Transactions are polled with eth_getTransactionByHash (300 a
 * minute), never with views (gen_call is 30 a minute per client, shared with sim_fundAccount). A
 * round no majority carried stores nothing; it is sent again and both transactions are kept. Every
 * step is saved as it is made, so a run cut off part way continues without sending anything twice.
 * A whole run takes about 20 to 25 minutes, most of it P2's 900-second window.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const STATE = process.env.STATE || join(tmpdir(), "steelman-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;

// ---------- state: keys, addresses and every step already made survive a cut-off run ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || [];
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = { p: "the proposer", a: "objector A, who restates faithfully", b: "objector B, who argues with a strawman", s: "a stranger" };
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
st.recipient = st.recipient || getAddress("0x" + randomBytes(20).toString("hex"));   // no key exists for it
const R = st.recipient;
const low = (a) => String(a).toLowerCase();
save();

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed; amount in atto, as a number
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so
// nothing is ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => low(t.from_address) === low(addr) && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settle = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step: a signed transaction, its tally, what it returned, and the balances it moved. begin()
// sends it (once), end() waits for it; call() is both. opt.watch names addresses whose balances are
// read before and after, and opt.expect the change each should show: a table, or a function of what
// the call returned, because what an objection moves depends on how it was read.
const begin = async (id, who, fn, args = [], opt = {}) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, fn, args: args.map(String), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (rec.done || rec.pending) return;
  if (!rec.before) { rec.before = {}; for (const [k, a] of Object.entries(opt.watch || {})) rec.before[k] = String(await balance(a)); save(); }
  rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: st.contract, functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
  save();
};
const end = async (id, who, fn, args = [], opt = {}) => {
  const rec = st.steps[id];
  if (!rec.done) {
    for (;;) {
      if (!rec.pending) await begin(id, who, fn, args, opt);
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${fn}(${args.map((x) => String(x).slice(0, 22)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      const again = opt.again ? opt.again(r) : 0;
      if (again > 0) { console.log(`      not yet; waiting ${Math.round(again / 1000)} s and sending it again`); await sleep(again); continue; }
      break;
    }
    const last = rec.tries[rec.tries.length - 1];
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(last.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const [k, a] of Object.entries(opt.watch || {})) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(a) : await settle(a, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const call = async (id, who, fn, args = [], opt = {}) => { await begin(id, who, fn, args, opt); return end(id, who, fn, args, opt); };
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async () => {
  const id = "deploy";
  if (!st.steps[id]) { st.steps[id] = { id, who: "p", fn: "deploy steelman.py", args: [], value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = readFileSync(new URL("../../contracts/steelman.py", import.meta.url));
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw("p", "deploy", () => client.p.deployContract({ code, args: [], leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] P deploy steelman.py  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return rec.address;
};

// ---------- reads: paced, and made again on a 429 instead of failing ----------
let lastRead = 0;
const read = async (fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st.contract, functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, fn, args = []) => { if (!st.views[id]) { st.views[id] = { fn, args, at: stamp(), out: await read(fn, args) }; save(); } return st.views[id].out; };
// wait, by the chain's own clock, until a proposal's window has passed
const untilClosable = async (pid) => {
  const row = await read("proposal", [pid]);
  const left = Number(row.closes_at || 0) - Number(row.now > 0 ? row.now : Math.floor(Date.now() / 1000));
  if (row.status === "open" && left > -15) { console.log(`      [${stamp()}] waiting ${left + 20} s for the window of ${pid} to pass`); await sleep((left + 20) * 1000); }
};
const notYet = (r) => { const m = /open for another (\d+) seconds/.exec(r.msg); return r.exec === "ERROR" && m ? (Number(m[1]) + 15) * 1000 : 0; };

// ---------- the demonstration ----------
const VALUE = 3n * GEN, BOND = 1n * GEN, WINDOW = 300, WINDOW2 = 900;
const TITLE = "Translate the beginner guide";
const TEXT = "Spend 3 GEN from the community fund to pay one translator to translate the project's beginner guide (the twelve-page getting-started document) into Spanish and Portuguese. The translator is paid only after both translated versions are published on the project's documentation site. The rest of the fund is not touched by this proposal.";
// P2 changes one thing: it names the rewritten guide, which is what A's reason was about
const TITLE2 = "Translate the rewritten beginner guide";
const TEXT2 = "Spend 3 GEN from the community fund to pay one translator to translate the rewritten beginner guide (version 2, the ten-page getting-started document published on 2 November) into Spanish and Portuguese. The translator is paid only after both translated versions are published on the project's documentation site. The rest of the fund is not touched by this proposal.";
const FAITHFUL = "Pay one translator 3 GEN from the fund to translate the twelve-page beginner guide into Spanish and Portuguese, paid only once both versions are published on the documentation site, with the rest of the fund left untouched.";
const STRAWMAN = "Hand the whole fund to one person to translate the entire website into every language they choose.";
const REASON_A = "The beginner guide is being rewritten next month, so translating the current version now pays for text that is about to be replaced.";
const REASON_B = "Nobody should get the whole fund for a translation job; the money is needed for hosting.";
const W = (k) => ({ [k]: acct[k].address });
// what an objection moves for its objector and the proposer, by how it was read
const objMoves = (who) => (j) => j?.verdict === "distorted" ? { [who]: -BOND, p: BOND } : j?.verdict === "faithful" ? { [who]: -BOND, p: 0n } : { [who]: 0n, p: 0n };

await fundOnce("p", 12); await fundOnce("a", 4); await fundOnce("b", 4); await fundOnce("s", 4);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.start.r = String(await balance(R)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase() + "  " + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           R  ${R}  the recipient, no key\n           state ${STATE}`);

// ================================================================ 1
console.log(`\n[${stamp()}] ---- 1: deploy, and a window too short to object in`);
st.contract = st.contract || await deploy();
save();
console.log(`      Steelman at ${st.contract}`);
{
  const short = await call("proposeShort", "p", "propose", [TITLE, TEXT, R, 60, 1, String(BOND)], { value: VALUE, watch: W("p"), expect: { p: 0n } });
  ok("a proposal with a one-minute window is refused and its 3 GEN come back", short.j?.ok === false && String(short.j?.reason).includes("the objection window is 300") && short.j?.returned === String(VALUE) && moved(short, "p", 0n), `${votes(short)}  ${short.j?.reason || short.msg.slice(0, 90)}`);
}

// ================================================================ 2
console.log(`\n[${stamp()}] ---- 2: P1, a strawman and a faithful restatement`);
{
  const p1 = await call("proposeP1", "p", "propose", [TITLE, TEXT, R, WINDOW, 1, String(BOND)], { value: VALUE, watch: W("p"), expect: { p: -VALUE } });
  ok("P1 is opened with 3 GEN behind it, threshold 1, bond 1 GEN, window 300 s", p1.j?.ok === true && p1.j?.proposal === "P1" && p1.j?.closes_at - p1.j?.opened_at === WINDOW && moved(p1, "p", -VALUE), `${votes(p1)}  ${p1.msg.slice(0, 120)}`);
  st.P1 = p1.j?.proposal || "P1"; save();
  // both objections go out back to back, so both are judged inside the 300-second window
  const sb = ["strawmanP1", "b", "object", [st.P1, STRAWMAN, REASON_B], { value: BOND, watch: { b: acct.b.address, p: acct.p.address }, expect: objMoves("b") }];
  const fa = ["faithfulP1", "a", "object", [st.P1, FAITHFUL, REASON_A], { value: BOND, watch: W("a"), expect: (j) => ({ a: objMoves("a")(j).a }) }];
  await begin(...sb); await begin(...fa);
  const b1 = await end(...sb), a1 = await end(...fa);
  ok("B's strawman is read as distorted in both framings", b1.j?.verdict === "distorted" && b1.j?.counted === false, `${votes(b1)}  ${b1.j?.verdict || b1.j?.reason || b1.msg.slice(0, 80)}`);
  ok("and B's bond goes to the proposer in the same transaction", b1.j?.to_proposer === String(BOND) && moved(b1, "b", -BOND) && moved(b1, "p", BOND), JSON.stringify(b1.delta));
  ok("A's restatement is read as faithful and counts", a1.j?.verdict === "faithful" && a1.j?.counted === true && a1.j?.faithful === 1, `${votes(a1)}  ${a1.j?.verdict || a1.j?.reason || a1.msg.slice(0, 80)}`);
  ok("and A's bond is held, not spent", a1.j?.held === String(BOND) && moved(a1, "a", -BOND), JSON.stringify(a1.delta));
  const row = await seen("P1open", "proposal", [st.P1]);
  ok("proposal(P1): one faithful objection, one bond held, and it would be blocked", row.faithful === 1 && row.distorted === 1 && row.held === String(BOND) && row.would_be === "blocked", JSON.stringify({ faithful: row.faithful, distorted: row.distorted, held: row.held, would_be: row.would_be }));
}

// ================================================================ 3
console.log(`\n[${stamp()}] ---- 3: P2, the revised proposal, and the refusals that ask no model`);
{
  const p2 = await call("proposeP2", "p", "propose", [TITLE2, TEXT2, R, WINDOW2, 1, String(BOND)], { value: VALUE, watch: W("p"), expect: { p: -VALUE } });
  ok("P2, which names the rewritten guide, is opened with the same terms and a 900-second window", p2.j?.ok === true && p2.j?.proposal === "P2" && moved(p2, "p", -VALUE), `${votes(p2)}  ${p2.msg.slice(0, 120)}`);
  st.P2 = p2.j?.proposal || "P2"; save();
  const early = await call("closeEarlyP2", "s", "close", [st.P2]);
  ok("a close before the window ends is refused", refused(early, "is open for another"), `${votes(early)}  ${early.msg.slice(0, 100)}`);
  const own = await call("proposerObjectsP2", "p", "object", [st.P2, FAITHFUL, REASON_A], { value: BOND, watch: W("p"), expect: { p: 0n } });
  ok("the proposer cannot object, and the bond comes back", own.j?.ok === false && String(own.j?.reason).includes("may not object") && own.j?.returned === String(BOND) && moved(own, "p", 0n), `${votes(own)}  ${own.j?.reason}`);
  const half = await call("wrongBondP2", "b", "object", [st.P2, STRAWMAN, REASON_B], { value: BOND / 2n, watch: W("b"), expect: { b: 0n } });
  ok("half a bond is refused and comes back", half.j?.ok === false && String(half.j?.reason).includes("send exactly the bond") && half.j?.returned === String(BOND / 2n) && moved(half, "b", 0n), `${votes(half)}  ${half.j?.reason}`);
  const b2 = await call("strawmanP2", "b", "object", [st.P2, STRAWMAN, REASON_B], { value: BOND, watch: { b: acct.b.address, p: acct.p.address }, expect: objMoves("b") });
  ok("the same strawman put to P2 is judged afresh, and is distorted again", b2.j?.verdict === "distorted" && moved(b2, "p", BOND), `${votes(b2)}  ${b2.j?.verdict || b2.j?.reason}`);
  const copy = await call("copyP2", "s", "object", [st.P2, "  " + STRAWMAN.toUpperCase() + "  ", REASON_B], { value: BOND, watch: W("s"), expect: { s: 0n } });
  ok("S copies those words in other case and spacing: refused with no round, and the bond comes back", copy.j?.ok === false && String(copy.j?.reason).includes("restate it in your own words") && moved(copy, "s", 0n), `${votes(copy)}  ${copy.j?.reason}`);
}

// ================================================================ 4
console.log(`\n[${stamp()}] ---- 4: a stranger closes P1`);
{
  if (!st.steps.closeP1?.done) await untilClosable(st.P1);
  const c1 = await call("closeP1", "s", "close", [st.P1], { watch: { p: acct.p.address, a: acct.a.address, s: acct.s.address }, expect: { p: VALUE, a: BOND, s: 0n }, again: notYet });
  ok("S, who has no part in P1, closes it after the window: blocked", c1.j?.status === "blocked" && c1.j?.paid_to === "proposer", `${votes(c1)}  ${c1.msg.slice(0, 120)}`);
  ok("the 3 GEN go back to the proposer and A's bond back to A, in the same call", moved(c1, "p", VALUE) && moved(c1, "a", BOND) && moved(c1, "s", 0n) && c1.j?.bonds_returned === String(BOND), JSON.stringify(c1.delta));
}

// ================================================================ 5
console.log(`\n[${stamp()}] ---- 5: P2's window runs out with no faithful objection`);
{
  if (!st.steps.closeP2?.done) await untilClosable(st.P2);
  const c2 = await call("closeP2", "p", "close", [st.P2], { watch: { r: R, p: acct.p.address }, expect: { r: VALUE, p: 0n }, again: notYet });
  ok("P2 is closed: passed", c2.j?.status === "passed" && c2.j?.paid_to === "recipient" && c2.j?.to === low(R), `${votes(c2)}  ${c2.msg.slice(0, 120)}`);
  ok("and the 3 GEN reach the recipient, which holds no key and signed nothing", moved(c2, "r", VALUE), JSON.stringify(c2.delta));
}

// ================================================================ 6
console.log(`\n[${stamp()}] ---- 6: the views, the code, and the money`);
{
  const p1 = await seen("P1", "proposal", [st.P1]), p2 = await seen("P2", "proposal", [st.P2]);
  ok("proposal(P1).status is blocked and proposal(P2).status is passed", p1.status === "blocked" && p2.status === "passed" && p1.held === "0", JSON.stringify({ P1: p1.status, P2: p2.status }));
  const of1 = await seen("of1", "objections_of", [st.P1]);
  ok("objections_of(P1): the strawman and the faithful restatement, both judged", Array.isArray(of1.ids) && of1.ids.length === 2, JSON.stringify(of1));
  // the two were sent back to back, so a round sent a second time can swap their ids: find each by its author
  const rows = [];
  for (const [n, id] of (of1.ids || []).entries()) rows.push(await seen("objP1_" + n, "objection", [id]));
  const oa = rows.find((o) => o.objector === low(acct.a.address)) || {}, ob = rows.find((o) => o.objector === low(acct.b.address)) || {};
  ok("objection(A): faithful, the reason stored as written, the bond released at close", oa.verdict === "faithful" && oa.reason === REASON_A && oa.held === "0" && oa.released_at > 0 && oa.objector === low(acct.a.address), JSON.stringify({ verdict: oa.verdict, held: oa.held }));
  ok("objection(B): distorted, the bond paid to the proposer", ob.verdict === "distorted" && ob.to_proposer === String(BOND) && ob.objector === low(acct.b.address), JSON.stringify({ verdict: ob.verdict, to_proposer: ob.to_proposer }));
  const sb = await seen("standingB", "standing", [st.P2, acct.b.address]);
  ok("standing(P2, B): one judged attempt used, two left, nothing counted", sb.attempts_used === 1 && sb.counted === "", JSON.stringify(sb));
  const stats = await seen("stats", "stats", []);
  ok("stats(): two proposals, one blocked, one passed, nothing held", stats.proposals === 2 && stats.blocked === 1 && stats.passed === 1 && stats.value_held === "0" && stats.bonds_held === "0" && stats.balance_owed === "0", JSON.stringify(stats));
  ok("the contract's own balance is zero", (await balance(st.contract)) === 0n, String(await balance(st.contract)));
  const rules = await seen("rules", "rules", []);
  ok("rules(): the agreement rule in words, with the limits", String(rules.compared).includes("exact string equality") && rules.limits?.attempts === 3, Object.keys(rules).join(","));

  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const file = readFileSync(new URL("../../contracts/steelman.py", import.meta.url));
  const chain = Buffer.from(String(await rpc("gen_getContractCode", [st.contract])), "base64");
  st.code = { address: st.contract, bytes: chain.length, sha256: sha(chain), file_bytes: file.length, file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
  save();
  ok(`the code deployed at ${st.contract} is byte for byte contracts/steelman.py`, st.code.identical, `${chain.length} bytes, sha256 ${st.code.sha256}`);

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address)); st.end.r = String(await balance(R));
  st.ended = new Date().toISOString(); save();
  // what each account should have gained or lost, read off the receipts: each proposal takes its
  // value from P; a blocked one gives it back to P and a passed one gives it to R; a strawman's bond
  // moves from its objector to P; a faithful bond comes back at close; refusals move nothing
  const want = { p: 0n, a: 0n, b: 0n, s: 0n, r: 0n };
  for (const id of st.order) {
    const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || "");
    if (s.fn === "propose" && j?.ok) want[s.who] -= BigInt(j.value);
    if (s.fn === "object" && j?.verdict === "distorted") { want[s.who] -= BigInt(j.to_proposer); want.p += BigInt(j.to_proposer); }
    if (s.fn === "close" && j?.status === "blocked") want.p += BigInt(j.value);
    if (s.fn === "close" && j?.status === "passed") want.r += BigInt(j.value);
  }
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  ok("over the run every account ends exactly where the receipts say", Object.keys(want).every((k) => net(k) === want[k]), Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18 + " (receipts " + Number(want[k]) / 1e18 + ")").join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("Steelman:", st.contract);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (j?.verdict) console.log(`${id.padEnd(14)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.verdict} ${j.objection}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
