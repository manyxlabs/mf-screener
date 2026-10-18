"""Walk-forward test of the composite's weight table: does a different table rank better?

Stage 1 (--build) forms the ranking at quarterly past dates exactly as backtest_score.py
does - every input recomputed from NAV up to the formation date - and stores each fund's
per-component percentile from the live score_fund, with its forward 1y and 3y CAGR. Weights
only enter at the final blend, so every table can then be scored from that one cache.

Stage 2 grid-searches tables on early formation dates and reports them on later, held-out
dates, beside the live table. --neighbours instead moves 0.02/0.05 between each pair of
components and prints the moves that help at both horizons, train and test alike.

A table that wins only on its training dates is fitting that market phase, not ranking
funds better: in the run documented in docs/backtest.md every grid winner lost to the live
table on the held-out dates.

Usage: uv run python scripts/optimize_weights.py --build     # ~15 min, six processes
       uv run python scripts/optimize_weights.py [--neighbours]
"""

from __future__ import annotations

import argparse
import itertools
from concurrent.futures import ProcessPoolExecutor

import backtest_score as bt
import duckdb
import numpy as np
import pandas as pd

from mf_analytics.config import get_settings
from mf_analytics.scoring import COMPONENT_WEIGHTS, MIN_COVERAGE, score_fund

CACHE = get_settings().cache_dir / "component_percentiles.parquet"
# index_skill needs the benchmark map as of the formation date, which the store lacks.
COMPONENTS = [c for c in COMPONENT_WEIGHTS if c != "index_skill"]
# (forward column, last training formation, first test formation). The gap keeps a test
# formation from sitting inside a training window's forward return.
SPLITS = {
    "3y": ("fwd_3y", "2020-12-31", "2021-12-31"),
    "1y": ("fwd_1y", "2022-12-31", "2023-12-31"),
}
MIN_GROUP = 10


def _build_one(formation: str) -> pd.DataFrame:
    settings = get_settings()
    con = duckdb.connect(str(settings.mf_duckdb_path), read_only=True)
    as_of = pd.Timestamp(formation)
    universe = bt.universe_as_of(con, as_of)
    nav = con.execute(bt.NAV_SQL, [as_of.date()]).df()
    nav["scheme_code"] = nav["scheme_code"].astype(str)
    nav["date"] = pd.to_datetime(nav["date"])
    jump = settings.mf_nav_jump_ratio
    features = bt._features_as_of(nav, universe, as_of, settings.risk_free_monthly, jump)
    equal = dict.fromkeys(COMPONENTS, 1.0)
    rows = []
    for peer_group, peers in features.groupby("peer_group"):
        peers = peers.reset_index(drop=True)
        if len(peers) < bt.MIN_PEERS + 1:
            continue
        for code in peers["scheme_code"]:
            result = score_fund(peers, str(code), min_peers=bt.MIN_PEERS, weights=equal)
            row = {"formation": formation, "scheme_code": str(code), "peer_group": peer_group}
            row.update({name: result.components[name].percentile for name in COMPONENTS})
            rows.append(row)
    out = pd.DataFrame(rows)
    for years in (1, 3):
        out[f"fwd_{years}y"] = out["scheme_code"].map(bt._forward_cagr(con, as_of, years, jump))
    print(f"built {formation}: {len(out)} funds", flush=True)
    return out


def build() -> None:
    dates = pd.date_range("2018-12-31", "2025-09-30", freq="QE").strftime("%Y-%m-%d")
    with ProcessPoolExecutor(max_workers=6) as pool:
        frames = list(pool.map(_build_one, dates))
    pd.concat(frames).to_parquet(CACHE)


def _ranks(x: np.ndarray) -> np.ndarray:
    return np.argsort(np.argsort(x)).astype(float)


def _groups(frame: pd.DataFrame, fwd: str) -> list[tuple[np.ndarray, np.ndarray]]:
    frame = frame.dropna(subset=[fwd])
    return [
        (g[COMPONENTS].to_numpy(dtype=float), g[fwd].to_numpy(dtype=float))
        for _, g in frame.groupby(["formation", "peer_group"])
        if len(g) >= MIN_GROUP
    ]


def evaluate(groups: list[tuple[np.ndarray, np.ndarray]], weights: np.ndarray) -> dict[str, float]:
    """Within-peer-group outcomes, pooled over (formation, peer group) by fund count.

    Mirrors score_fund's blend: renormalised over the components a fund has, withheld
    below MIN_COVERAGE.
    """
    ics, hits, edges, top1, n = [], [], [], [], []
    for pct, ret in groups:
        w = weights * ~np.isnan(pct)
        covered = w.sum(axis=1)
        ok = covered / weights.sum() >= MIN_COVERAGE
        if ok.sum() < MIN_GROUP:
            continue
        score = (np.nan_to_num(pct[ok]) * w[ok]).sum(axis=1) / covered[ok]
        r = ret[ok]
        median = np.median(r)
        order = np.argsort(-score)
        top = r[order[: max(len(r) // 5, 1)]]
        ics.append(np.corrcoef(_ranks(score), _ranks(r))[0, 1])
        hits.append(float(np.median(top) > median))
        edges.append(np.median(top) - median)
        top1.append(r[order[0]] - median)
        n.append(len(r))
    weight = np.array(n, dtype=float)
    return {
        name: float(np.average(np.nan_to_num(values), weights=weight))
        for name, values in (("ic", ics), ("hit", hits), ("edge", edges), ("top1", top1))
    }


def _grid(step: float = 0.1) -> list[np.ndarray]:
    units = round(1 / step)
    return [
        np.array([*combo, units - sum(combo)], dtype=float) / units
        for combo in itertools.product(range(units + 1), repeat=len(COMPONENTS) - 1)
        if sum(combo) <= units
    ]


def _line(label: str, w: np.ndarray, train: dict[str, float], test: dict[str, float]) -> str:
    table = " ".join(f"{c[:5]}={x:.2f}" for c, x in zip(COMPONENTS, w, strict=True))
    return (
        f"{label:14} [{table}]\n"
        f"   train IC {train['ic']:+.3f} hit {train['hit']:.0%} top1 {train['top1']:+.2%}"
        f"  | test IC {test['ic']:+.3f} hit {test['hit']:.0%} edge {test['edge']:+.2%}"
        f" top1 {test['top1']:+.2%}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--neighbours", action="store_true")
    args = parser.parse_args()
    if args.build:
        build()
        return

    data = pd.read_parquet(CACHE)
    data["formation"] = pd.to_datetime(data["formation"])
    splits = {
        name: (
            _groups(data[data["formation"] <= train_end], fwd),
            _groups(data[data["formation"] >= test_start], fwd),
        )
        for name, (fwd, train_end, test_start) in SPLITS.items()
    }
    live = np.array([COMPONENT_WEIGHTS[c] for c in COMPONENTS])

    if args.neighbours:

        def ics(w: np.ndarray) -> dict[str, float]:
            return {
                f"{name}-{part}": evaluate(groups, w)["ic"]
                for name, (train, test) in splits.items()
                for part, groups in (("train", train), ("test", test))
            }

        base = ics(live)
        print("live", {k: round(v, 3) for k, v in base.items()})
        for (i, src), (j, dst) in itertools.permutations(enumerate(COMPONENTS), 2):
            for step in (0.02, 0.05):
                if live[i] < step - 1e-9:
                    continue
                w = live.copy()
                w[i] -= step
                w[j] += step
                delta = {k: v - base[k] for k, v in ics(w).items()}
                if min(delta.values()) > -0.002 and sum(d > 0.002 for d in delta.values()) >= 3:
                    print(f"{src} -> {dst} {step}:", {k: round(v, 3) for k, v in delta.items()})
        return

    for name, (train, test) in splits.items():
        print(f"\n--- forward {name}")
        print(_line("live", live, evaluate(train, live), evaluate(test, live)))
        ranked = sorted(_grid(), key=lambda w: evaluate(train, w)["ic"], reverse=True)
        for rank, w in enumerate(ranked[:5], 1):
            print(_line(f"train best #{rank}", w, evaluate(train, w), evaluate(test, w)))


if __name__ == "__main__":
    main()
