"""Returns-based style analysis: what a fund behaves like, when its holdings are unknown.

AMFI publishes no portfolio, so the only evidence of what a fund owns is how its NAV
moved. Sharpe's method fits the fund's monthly returns to a basket of index returns
under portfolio constraints - every weight at or above zero, all of them summing to one
- and reads the fitted weights as the mix of exposures that behaved most like the fund.

The result is an estimate of behaviour, never a holdings statement. Two funds owning
different stocks with the same size and sector tilt are indistinguishable here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations, pairwise

import numpy as np
import numpy.typing as npt
import pandas as pd

from ..quality import Metric, Reason

MIN_MONTHS_DEFAULT = 24
# Below this the basis is not describing the fund, and its fitted weights are an artefact
# of forcing a long-only mix onto returns it cannot explain. Reported as a refusal instead.
MIN_R_SQUARED_DEFAULT = 0.5
# A weight this small is fitting noise, and reporting it as an exposure would overstate
# what the regression can distinguish.
WEIGHT_FLOOR = 1e-4
# Enumerating active sets costs 2^n solves, which is instant at 10 and not at 30.
MAX_FACTORS = 12

# The window a style drift series is refit over. Fixed rather than configurable: it is
# also what "3y" in `style_drift_3y` promises, so the two must not drift apart.
ROLLING_WINDOW_MONTHS = 36
# Below two fitted windows there is no consecutive pair to diff, so no drift figure at all.
MIN_DRIFT_WINDOWS = 2


@dataclass(frozen=True, slots=True)
class Exposure:
    """Fitted factor weights, or the reason there are none."""

    weights: dict[str, float] = field(default_factory=dict)
    r_squared: float | None = None
    months: int = 0
    first_date: pd.Timestamp | None = None
    last_date: pd.Timestamp | None = None
    reason: str | None = None


def style_exposure(
    fund: pd.Series,
    factors: pd.DataFrame,
    min_months: int = MIN_MONTHS_DEFAULT,
    min_r_squared: float = MIN_R_SQUARED_DEFAULT,
) -> Exposure:
    """Fit `fund` to `factors` with weights that are non-negative and sum to one.

    Both are monthly simple returns. Only the months present in every series are used,
    so the fit is limited by the shortest factor series rather than silently padded.
    """
    if factors.empty or factors.shape[1] == 0:
        return Exposure(reason=Reason.BENCHMARK_UNAVAILABLE)
    if factors.shape[1] > MAX_FACTORS:
        raise ValueError(f"At most {MAX_FACTORS} factors, got {factors.shape[1]}")

    paired = pd.concat([fund.rename("__fund"), factors], axis=1, join="inner").dropna()
    if len(paired) < min_months:
        return Exposure(months=len(paired), reason=Reason.INSUFFICIENT_OBSERVATIONS)

    y = paired["__fund"].to_numpy(dtype=float)
    names = [str(c) for c in factors.columns]
    x = paired[names].to_numpy(dtype=float)

    weights = _constrained_least_squares(x, y)
    residual = y - x @ weights
    total = y - y.mean()
    denominator = float(total @ total)
    r_squared = None if denominator == 0.0 else 1.0 - float(residual @ residual) / denominator
    index = pd.DatetimeIndex(paired.index)
    # The R-squared is kept even when it fails, so the page can say how badly it fitted
    # rather than only that it did.
    if r_squared is None or r_squared < min_r_squared:
        return Exposure(
            r_squared=r_squared,
            months=len(paired),
            first_date=index[0],
            last_date=index[-1],
            reason=Reason.STYLE_FIT_TOO_WEAK,
        )
    return Exposure(
        weights={n: float(w) for n, w in zip(names, weights, strict=True) if w > WEIGHT_FLOOR},
        r_squared=r_squared,
        months=len(paired),
        first_date=index[0],
        last_date=index[-1],
    )


def _constrained_least_squares(
    x: npt.NDArray[np.float64], y: npt.NDArray[np.float64]
) -> npt.NDArray[np.float64]:
    """Least squares subject to weights >= 0 summing to 1, solved exactly.

    The optimum sets some weights to zero, and which ones is the whole difficulty. With
    a handful of factors every possible set of non-zero weights can simply be tried: for
    each, the sum-to-one constraint is substituted out and the rest solved as ordinary
    least squares. The best solution that is feasible is the answer, with no tolerance
    to tune and no iteration to converge.
    """
    n = x.shape[1]
    best: npt.NDArray[np.float64] | None = None
    best_error = np.inf
    for size in range(1, n + 1):
        for support in combinations(range(n), size):
            candidate = _solve_on_support(x, y, list(support), n)
            if candidate is None:
                continue
            error = float(np.sum((y - x @ candidate) ** 2))
            if error < best_error:
                best_error, best = error, candidate
    if best is None:  # unreachable: a single factor at weight 1 is always feasible
        raise RuntimeError("No feasible weighting found")
    return best


def _solve_on_support(
    x: npt.NDArray[np.float64], y: npt.NDArray[np.float64], support: list[int], n: int
) -> npt.NDArray[np.float64] | None:
    """Least squares over `support` with those weights summing to one, or None if infeasible."""
    anchor, rest = support[0], support[1:]
    weights = np.zeros(n)
    if not rest:
        weights[anchor] = 1.0
        return weights
    # w_anchor = 1 - sum(rest), so the constraint disappears into the design matrix.
    design = x[:, rest] - x[:, [anchor]]
    solved = np.linalg.lstsq(design, y - x[:, anchor], rcond=None)[0]
    anchor_weight = 1.0 - float(solved.sum())
    if anchor_weight < -WEIGHT_FLOOR or bool(np.any(solved < -WEIGHT_FLOOR)):
        return None
    weights[anchor] = max(anchor_weight, 0.0)
    weights[rest] = np.maximum(solved, 0.0)
    return weights


def exposure_metric(exposure: Exposure) -> Metric:
    """The fit quality as a Metric, so a null R-squared carries the same reason vocabulary."""
    if exposure.r_squared is None:
        return Metric.missing(exposure.reason or Reason.INSUFFICIENT_OBSERVATIONS, exposure.months)
    return Metric(exposure.r_squared, exposure.months)


def rolling_style_exposure(
    fund: pd.Series,
    factors: pd.DataFrame,
    window_months: int = ROLLING_WINDOW_MONTHS,
    min_r_squared: float = MIN_R_SQUARED_DEFAULT,
) -> list[Exposure]:
    """Refit `style_exposure` on every trailing `window_months` window, stepped monthly.

    Each window has exactly `window_months` paired observations, so the only way a
    window is refused is a weak fit - never a short one - and a weak window is dropped
    from the series with its reason rather than repeating the previous window's weights.
    """
    if factors.empty or factors.shape[1] == 0:
        return []
    paired = pd.concat([fund.rename("__fund"), factors], axis=1, join="inner").dropna()
    if len(paired) < window_months:
        return []
    names = [str(c) for c in factors.columns]
    windows = []
    for end in range(window_months - 1, len(paired)):
        chunk = paired.iloc[end - window_months + 1 : end + 1]
        windows.append(style_exposure(chunk["__fund"], chunk[names], window_months, min_r_squared))
    return windows


def weight_turnover(a: Exposure, b: Exposure) -> float:
    """Half the L1 distance between two fitted weight vectors: 0 unchanged, 1 a full switch."""
    names = set(a.weights) | set(b.weights)
    return sum(abs(b.weights.get(n, 0.0) - a.weights.get(n, 0.0)) for n in names) / 2.0


def style_drift(exposures: list[Exposure], min_windows: int = MIN_DRIFT_WINDOWS) -> Metric:
    """Mean turnover between consecutive successfully-fitted windows in `exposures`.

    Windows below the R-squared floor carry no weights and are skipped rather than
    diffed against, so a stretch of refusals never manufactures a drift reading out of
    two unrelated fitted windows either side of it.
    """
    fitted = [e for e in exposures if e.reason is None]
    if len(fitted) < min_windows:
        return Metric.missing(Reason.INSUFFICIENT_WINDOWS, len(fitted))
    turnovers = [weight_turnover(a, b) for a, b in pairwise(fitted)]
    return Metric(float(np.mean(turnovers)), len(turnovers))
