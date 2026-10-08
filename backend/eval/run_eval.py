"""Evaluation harness (deep-dive section 7).

Runs every script in eval/scripts/{scam,benign} through the same CallSession the
live app uses, then reports:
  * recall at Level 2 (scam calls that reached WARNING or higher)
  * false alerts (benign calls that reached WARNING or higher; cautions listed separately)
  * time-to-alert, and how many seconds BEFORE the first money/OTP/remote-access ask it came
  * an ablation: L1 only → L1+L2 → L1+L2+L3 (L3 only when an LLM key is configured)

Usage (from backend/):
  python -m eval.run_eval                 # all available configurations
  python -m eval.run_eval --configs l1 l1l2
  python -m eval.run_eval --embed ngram   # force the dependency-free L2 backend
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.config import settings  # noqa: E402
from app.detection.llm import LLMReasoner  # noqa: E402
from app.detection.semantic import SemanticMatcher  # noqa: E402
from app.session import CallSession, Engine, SessionOptions  # noqa: E402

CONFIGS = {
    "l1": {"label": "L1 rules only", "use_l2": False, "use_l3": False},
    "l1l2": {"label": "L1 + L2 semantic", "use_l2": True, "use_l3": False},
    "l1l2l3": {"label": "L1 + L2 + L3 LLM", "use_l2": True, "use_l3": True},
}
WARN_LEVEL = 2


SETS = {
    "dev": "scripts",              # used while tuning the lexicon and libraries
    "heldout": "scripts_heldout",  # written later and never tuned against: quote these numbers
}


def load_scripts(script_set: str = "dev") -> list[dict]:
    out = []
    for kind in ("scam", "benign"):
        for p in sorted((HERE / SETS[script_set] / kind).glob("*.json")):
            d = json.loads(p.read_text(encoding="utf-8"))
            d["id"] = p.stem
            d["kind"] = kind
            out.append(d)
    return out


async def run_script(engine: Engine, script: dict, cfg: dict) -> dict:
    sess = CallSession(engine, SessionOptions(lang=script.get("lang", "en"), use_l2=cfg["use_l2"],
                                              use_l3=cfg["use_l3"], llm_mode="sync"))
    t = 0.0
    alert_t = None
    caution_t = None
    money_t = None
    max_level = 0
    for line in script["lines"]:
        t += line.get("delay", 0)
        if line.get("money_ask") and money_t is None:
            money_t = t
        u = await sess.process(line["text"], t=t, speaker=line.get("speaker", "caller"))
        max_level = max(max_level, u["level"])
        if u["level"] >= 1 and caution_t is None:
            caution_t = t
        if u["level"] >= WARN_LEVEL and alert_t is None:
            alert_t = t
    return {
        "id": script["id"], "kind": script["kind"], "lang": script.get("lang", "en"), "title": script["title"],
        "max_level": max_level, "peak_score": round(sess.peak_score), "alert_t": alert_t, "caution_t": caution_t,
        "money_t": money_t, "lead_s": (money_t - alert_t) if (alert_t is not None and money_t is not None) else None,
        "tactics": list(sess.scorer.state.tactics),
    }


def summarise(rows: list[dict]) -> dict:
    scam = [r for r in rows if r["kind"] == "scam"]
    benign = [r for r in rows if r["kind"] == "benign"]
    tp = sum(r["max_level"] >= WARN_LEVEL for r in scam)
    fp = sum(r["max_level"] >= WARN_LEVEL for r in benign)
    cautions = sum(r["max_level"] == 1 for r in benign)
    leads = [r["lead_s"] for r in scam if r["lead_s"] is not None]
    alerts = [r["alert_t"] for r in scam if r["alert_t"] is not None]
    before = sum(1 for x in leads if x > 0)
    return {
        "scam_total": len(scam), "benign_total": len(benign),
        "recall": tp / len(scam) if scam else 0.0,
        "precision": tp / (tp + fp) if (tp + fp) else 0.0,
        "detected": tp, "false_alerts": fp, "benign_cautions": cautions,
        "median_time_to_alert_s": statistics.median(alerts) if alerts else None,
        "median_lead_before_money_s": statistics.median(leads) if leads else None,
        "alerted_before_money_ask": before,
    }


def markdown(results: dict, meta: dict) -> str:
    lines = [
        "# Jam the Scam: evaluation results" + (" (held-out set)" if meta.get("set") == "heldout" else " (dev set)"),
        "",
        ("Held-out scripts: written after tuning and never used to adjust the lexicon or libraries. " if meta.get("set") == "heldout"
         else "Dev scripts: also used while tuning the lexicon and libraries, so these numbers are optimistic. "),
        "",
        f"Scripts: {meta['scam']} scam calls, {meta['benign']} benign hard negatives. "
        f"L2 backend: `{meta['l2']}`. L3: `{meta['l3']}`. Alert = Level 2 (WARNING, score ≥ 65) or higher.",
        "",
        "| Configuration | Scam calls caught | False alerts on benign | Precision | Median time to alert | Median lead before money ask | Alerted before money ask |",
        "|---|---|---|---|---|---|---|",
    ]
    for key, r in results.items():
        s = r["summary"]
        mt = f"{s['median_time_to_alert_s']:.0f}s" if s["median_time_to_alert_s"] is not None else "-"
        ml = f"{s['median_lead_before_money_s']:.0f}s" if s["median_lead_before_money_s"] is not None else "-"
        lines.append(
            f"| {CONFIGS[key]['label']} | {s['detected']}/{s['scam_total']} ({s['recall']:.0%}) | "
            f"{s['false_alerts']}/{s['benign_total']} (+{s['benign_cautions']} cautions) | {s['precision']:.0%} | "
            f"{mt} | {ml} | {s['alerted_before_money_ask']}/{s['detected']} |"
        )
    best = list(results)[-1]
    lines += ["", f"## Per-call detail ({CONFIGS[best]['label']})", "",
              "| Call | Kind | Lang | Peak | Level | Alert at | Money ask at | Tactics |", "|---|---|---|---|---|---|---|---|"]
    for r in results[best]["rows"]:
        lines.append(f"| {r['title']} | {r['kind']} | {r['lang']} | {r['peak_score']} | {r['max_level']} | "
                     f"{r['alert_t'] if r['alert_t'] is not None else '-'} | {r['money_t'] if r['money_t'] is not None else '-'} | "
                     f"{', '.join(r['tactics'])} |")
    lines += ["", "Scripts are written from patterns in public police advisories and news reports; they are not real call recordings. "
              "Text-level results: speech-to-text errors are not included."]
    return "\n".join(lines) + "\n"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--configs", nargs="*", default=None)
    ap.add_argument("--embed", default=settings.embed_backend, help="auto | st | ngram")
    ap.add_argument("--set", dest="script_set", choices=sorted(SETS), default="dev",
                    help="dev (tuned against) or heldout (never tuned against)")
    ap.add_argument("--l3-gap", type=float, default=0.0,
                    help="seconds to wait (wall clock) before each L3 call, to stay inside free-tier rate limits")
    args = ap.parse_args()

    llm = LLMReasoner()
    if args.l3_gap > 0:
        analyze = llm.analyze

        async def paced(*a, **kw):
            await asyncio.sleep(args.l3_gap)
            return await analyze(*a, **kw)

        llm.analyze = paced
    configs = args.configs or [k for k in CONFIGS if k != "l1l2l3" or llm.enabled]
    semantic = SemanticMatcher(args.embed, settings.embed_model)
    engine = Engine(semantic=semantic, llm=llm)
    scripts = load_scripts(args.script_set)

    results = {}
    for key in configs:
        t0 = time.perf_counter()
        rows = [await run_script(engine, s, CONFIGS[key]) for s in scripts]
        results[key] = {"summary": summarise(rows), "rows": rows, "seconds": round(time.perf_counter() - t0, 1)}
        s = results[key]["summary"]
        print(f"{CONFIGS[key]['label']:<20} caught {s['detected']}/{s['scam_total']}  false alerts "
              f"{s['false_alerts']}/{s['benign_total']} (+{s['benign_cautions']} cautions)  "
              f"median lead {s['median_lead_before_money_s']}s  [{results[key]['seconds']}s]")

    meta = {"set": args.script_set, "scam": sum(s["kind"] == "scam" for s in scripts), "benign": sum(s["kind"] == "benign" for s in scripts),
            "l2": semantic.backend_name, "l3": f"{llm.provider}:{llm.model}" if llm.enabled else "off"}
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    suffix = "" if args.script_set == "dev" else f"_{args.script_set}"
    (out / f"results{suffix}.json").write_text(json.dumps({"meta": meta, "results": results}, indent=1, ensure_ascii=False),
                                               encoding="utf-8")
    (out / f"RESULTS{suffix}.md").write_text(markdown(results, meta), encoding="utf-8")
    print(f"Wrote {out / f'RESULTS{suffix}.md'}")


if __name__ == "__main__":
    asyncio.run(main())
