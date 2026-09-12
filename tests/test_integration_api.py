"""End-to-end: synthetic lake -> metrics pipeline -> API. No network access."""

from __future__ import annotations

import csv
import io
from typing import Any

import pytest

from .fixtures_data import SCHEMES

pytest.importorskip("fastapi")


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """Build a synthetic store, point the whole app at it, and return a TestClient."""
    import os

    from mf_analytics.config import get_settings

    tmp = tmp_path_factory.mktemp("mfstore")
    os.environ["MF_DATA_DIR"] = str(tmp / "data")
    os.environ["MF_DUCKDB_PATH"] = str(tmp / "data" / "processed" / "test.duckdb")
    get_settings.cache_clear()
    settings = get_settings()

    from mf_analytics.pipeline import run as run_metrics

    from . import fixtures_data

    fixtures_data.build(settings)
    run_metrics(settings)

    from fastapi.testclient import TestClient

    import mf_api.main as api_main
    from mf_api import store

    store.close_connection()
    api_main.settings = settings
    with TestClient(api_main.app) as test_client:
        yield test_client
    store.close_connection()


def test_health_reports_loaded_schemes(client):
    payload = client.get("/health").json()
    assert payload["status"] == "ok"
    assert payload["schemes"] == len(SCHEMES)
    assert "not investment advice" in payload["disclaimer"].lower()


def test_metadata_exposes_coverage_and_ingest_log(client):
    payload = client.get("/metadata").json()
    assert payload["counts"]["scheme_metrics_snapshot"] == len(SCHEMES)
    assert payload["coverage"]["metrics_as_of"]
    assert payload["default_universe"]["plan_scope"] == "direct"


def test_screen_defaults_to_active_direct_growth(client):
    payload = client.get("/screen").json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert "S07" not in codes, "Regular plan must not appear under the default universe"
    assert "S08" not in codes, "IDCW option must not appear under the default universe"
    assert "S12" not in codes, "inactive scheme must not appear under the default universe"
    assert payload["methodology"]["peer_universe"]["option_scope"] == "growth"


def test_screen_can_include_inactive(client):
    payload = client.get(
        "/screen", params={"plan": ["Direct", "Regular"], "active_only": False}
    ).json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert "S12" in codes


def test_screen_widening_the_plan_filter_does_not_duplicate_a_fund(client):
    """S01, S07 and S08 are one fund under three codes, so asking for Direct and Regular
    together returns the Direct row alone rather than the same fund twice."""
    payload = client.get(
        "/screen", params={"plan": ["Direct", "Regular"], "active_only": False}
    ).json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert "S01" in codes
    assert "S07" not in codes


def test_screen_reaches_a_regular_plan_row_when_asked_for_it_alone(client):
    """The family winner is picked among the rows a filter leaves, so narrowing to
    Regular reaches S07 rather than substituting its Direct sibling."""
    payload = client.get("/screen", params={"plan": ["Regular"], "active_only": False}).json()
    codes = {row["scheme_code"] for row in payload["rows"]}
    assert codes == {"S07"}

    idcw = client.get("/screen", params={"option": ["IDCW Payout"], "active_only": False}).json()
    assert {row["scheme_code"] for row in idcw["rows"]} == {"S08"}


def test_screen_sorting_is_descending_and_nulls_last(client):
    rows = client.get("/screen", params={"sort": "cagr_5y:desc"}).json()["rows"]
    values = [r["cagr_5y"] for r in rows if r["cagr_5y"] is not None]
    assert values == sorted(values, reverse=True)


def test_screen_multi_column_sorting(client):
    payload = client.get("/screen", params={"sort": "clean_sub_category:asc,cagr_5y:desc"}).json()
    subs = [r["clean_sub_category"] for r in payload["rows"]]
    assert subs == sorted(subs)


def test_screen_rejects_unknown_sort_column(client):
    response = client.get("/screen", params={"sort": "drop_table:desc"})
    assert response.status_code == 400
    assert "Unknown sort column" in response.json()["detail"]


def test_screen_rejects_unknown_range_filter(client):
    response = client.get("/screen", params={"totally_made_up_min": 1})
    assert response.status_code == 400


def test_screen_numeric_range_filter(client):
    everything = client.get("/screen", params={"page_size": 100}).json()["rows"]
    threshold = sorted(r["cagr_5y"] for r in everything if r["cagr_5y"] is not None)[-2]
    filtered = client.get("/screen", params={"cagr_5y_min": threshold, "page_size": 100}).json()
    assert filtered["total"] == 2
    assert all(row["cagr_5y"] >= threshold for row in filtered["rows"])


def test_screen_pagination_is_stable_and_disjoint(client):
    first = client.get("/screen", params={"page": 1, "page_size": 3}).json()
    second = client.get("/screen", params={"page": 2, "page_size": 3}).json()
    assert first["total"] == second["total"]
    assert len(first["rows"]) == 3
    assert not {r["scheme_code"] for r in first["rows"]} & {
        r["scheme_code"] for r in second["rows"]
    }
    assert first["pages"] == -(-first["total"] // 3)


def test_screen_search_matches_name_and_amc(client):
    payload = client.get("/screen", params={"search": "small cap", "page_size": 100}).json()
    assert payload["total"] >= 3
    assert all("Small Cap" in row["scheme_name"] for row in payload["rows"])


def test_screen_column_selection(client):
    payload = client.get("/screen", params={"columns": "scheme_name,sharpe_5y"}).json()
    assert payload["columns"] == ["scheme_name", "scheme_code", "sharpe_5y"]
    assert set(payload["rows"][0]) == {"scheme_code", "scheme_name", "sharpe_5y"}


def test_the_fund_name_leads_and_the_code_survives_a_selection_that_omits_both(client):
    """The table pins its first column and links each row by code, so neither is optional."""
    payload = client.get("/screen", params={"columns": "sharpe_5y"}).json()
    assert payload["columns"][:2] == ["scheme_name", "scheme_code"]


def test_risk_and_regression_metrics_are_shown_without_opening_the_column_picker(client):
    """A default view that omits dispersion and alpha hides how a return was earned."""
    payload = client.get("/screen").json()
    for name in ("volatility_5y", "alpha_5y", "beta_5y", "r_squared_5y"):
        assert name in payload["columns"]


def test_expense_ratio_is_served_as_a_fraction_like_every_other_percent(client):
    """Stored as 0.62% the column would render 62% cost against a 48% return."""
    payload = client.get("/screen", params={"columns": "scheme_name,expense_ratio"}).json()
    priced = [r for r in payload["rows"] if r["expense_ratio"] is not None]
    assert priced and all(0 < r["expense_ratio"] < 0.1 for r in priced)


def test_an_unpriced_scheme_says_so_rather_than_showing_a_bare_dash(client):
    """A blank TER must not read as free, or as data that is merely still loading."""
    payload = client.get(
        "/screen", params={"columns": "scheme_name,expense_ratio,missing_reasons"}
    ).json()
    unpriced = [r for r in payload["rows"] if r["expense_ratio"] is None]
    assert unpriced
    assert all(r["missing_reasons"]["expense_ratio"] == "ter_not_published" for r in unpriced)
    assert "ter_not_published" in client.get("/columns").json()["missing_reasons"]


def test_a_priced_scheme_keeps_the_reasons_it_already_had(client):
    """The TER reason is merged into the map, so it must not overwrite the others."""
    rows = client.get(
        "/screen", params={"columns": "scheme_name,expense_ratio,missing_reasons", "search": "S01"}
    ).json()["rows"]
    priced = [r for r in rows if r["expense_ratio"] is not None]
    assert priced
    assert "expense_ratio" not in priced[0]["missing_reasons"]


def test_export_csv_carries_methodology_header(client):
    response = client.get("/export/csv", params={"columns": "scheme_name,cagr_5y"})
    assert response.status_code == 200
    body = response.text
    assert body.startswith("# Indian MF screener export.")
    assert "peer_universe=" in body
    rows = list(csv.reader(io.StringIO("\n".join(body.splitlines()[3:]))))
    assert rows[0] == ["scheme_name", "scheme_code", "cagr_5y"]
    assert len(rows) > 1


def test_export_respects_the_same_filters_as_the_screen(client):
    params: dict[str, Any] = {"sub_category": "Small Cap Fund", "columns": "scheme_name"}
    screened = client.get("/screen", params={**params, "page_size": 100}).json()
    exported = client.get("/export/csv", params=params).text.splitlines()
    assert len(exported) - 4 == screened["total"]


def test_scheme_metrics_expose_missing_reasons(client):
    payload = client.get("/schemes/S13/metrics").json()
    assert payload["fund_minus_category_5y"] is None
    assert payload["missing_reasons"]["fund_minus_category_5y"] == "insufficient_peer_universe"
    # Keyed by reason so the fund and compare pages can look one up from a reason code.
    reason = payload["missing_reasons"]["fund_minus_category_5y"]
    assert "peer" in payload["missing_reason_descriptions"][reason].lower()


def test_scheme_metrics_are_populated_for_a_full_peer_group(client):
    payload = client.get("/schemes/S01/metrics").json()
    for field in (
        "cagr_3y",
        "cagr_5y",
        "cagr_10y",
        "sharpe_5y",
        "sortino_5y",
        "volatility_5y",
        "max_drawdown_5y",
        "rolling_5y_median",
        "fund_minus_category_5y",
        "information_ratio_vs_category_5y",
        "beta_5y",
        "alpha_5y",
        "tracking_error_5y",
    ):
        assert payload[field] is not None, f"{field} should be computable for S01"
    assert payload["category_peer_count_5y"] == 5


def test_rolling_returns_endpoint_returns_series_and_summary(client):
    payload = client.get("/schemes/S01/rolling-returns", params={"horizon": 5}).json()
    assert payload["summary"]["window_count"] == len(payload["points"])
    assert payload["summary"]["median"] is not None
    assert payload["category_points"]


def test_comparison_endpoint_respects_universe_toggles(client):
    default = client.get("/schemes/S01/comparison").json()
    widened = client.get("/schemes/S01/comparison", params={"plan_scope": "direct_regular"}).json()
    assert default["peer_universe_size"] == 6
    assert widened["peer_universe_size"] == 7
    assert default["horizons"]["5y"]["excess"] is not None


def test_comparison_include_self_changes_the_peer_average(client):
    excluded = client.get("/schemes/S01/comparison").json()["horizons"]["5y"]
    included = client.get("/schemes/S01/comparison", params={"exclude_self": False}).json()[
        "horizons"
    ]["5y"]
    assert excluded["peer_count"] == 5
    assert included["peer_count"] == 6
    assert excluded["category_return"] != included["category_return"]


def test_unknown_scheme_returns_404(client):
    assert client.get("/schemes/NOPE/metrics").status_code == 404


def test_nav_endpoint_returns_points(client):
    payload = client.get("/schemes/S01/nav", params={"frequency": "monthly"}).json()
    assert len(payload["points"]) > 100
    assert set(payload["points"][0]) == {"date", "nav"}


def test_categories_and_category_metrics(client):
    items = client.get("/categories").json()["items"]
    mid = next(i for i in items if i["clean_sub_category"] == "Mid Cap Fund")
    assert mid["direct_growth_active_count"] == 6

    key = client.get("/schemes/S01/metrics").json()["category_key"]
    payload = client.get(f"/categories/{key}/metrics").json()
    assert payload["eligible_scheme_count"] == 6
    assert payload["monthly_returns"]


def test_methodology_document_is_complete(client):
    payload = client.get("/methodology").json()
    assert payload["risk_free_rate"]["monthly"] == pytest.approx((1.065) ** (1 / 12) - 1)
    assert "trailing_cagr" in payload["formulas"]
    assert payload["peer_universe_default"]["exclude_self"] is True
    assert len(payload["metric_catalog"]) > 50


def test_presets_are_served_and_resolvable(client):
    presets = client.get("/presets").json()
    assert {p["id"] for p in presets} >= {
        "long-term-consistency",
        "mid-multi-momentum",
        "small-cap-quality",
        "value-mandates",
        "sp500-comparison",
    }
    assert client.get("/presets/small-cap-quality").json()["sort"].startswith("rolling_5y_median")
    assert client.get("/presets/nope").status_code == 404


def test_preset_filters_run_against_the_screen(client):
    """Every column, sort token and cap band a preset names has to be one /screen accepts."""
    preset = client.get("/presets/small-cap-quality").json()
    params: dict[str, Any] = {
        "cap_band": preset["filters"]["cap_bands"],
        "plan": preset["filters"]["plans"],
        "option": preset["filters"]["options"],
        "sort": preset["sort"],
        "columns": ",".join(preset["columns"]),
        **preset["filters"]["ranges"],
    }
    response = client.get("/screen", params=params)

    assert response.status_code == 200
    assert all(row["cap_band"] == "Small Cap" for row in response.json()["rows"])


def test_the_value_preset_keeps_funds_whose_peer_column_is_blank(client):
    """A contra fund has too few peers to score, and the sleeve must still list it.

    Ranging on a peer-relative column drops a null row, so a threshold on category excess
    silently removed SEBI's whole Contra category - the sleeve's own description promises it.
    """
    preset = client.get("/presets/value-mandates").json()
    contra = client.get(
        "/screen", params={"sub_category": ["Contra Fund"], "columns": "fund_minus_category_5y"}
    ).json()["rows"]

    assert [row["fund_minus_category_5y"] for row in contra] == [None]

    params: dict[str, Any] = {
        "style": preset["filters"]["styles"],
        "plan": preset["filters"]["plans"],
        "option": preset["filters"]["options"],
        "sort": preset["sort"],
        "columns": "scheme_name,style,clean_sub_category",
        **preset["filters"]["ranges"],
    }
    rows = client.get("/screen", params=params).json()["rows"]

    assert all(row["style"] == "Value" for row in rows)
    assert "Contra Fund" in {row["clean_sub_category"] for row in rows}


def test_the_cap_band_filter_selects_the_declared_band(client):
    """Mid Cap is the one band the fixture gives a peer group large enough to score."""
    payload = client.get(
        "/screen",
        params={"cap_band": ["Mid Cap"], "columns": "cap_band,fund_minus_category_5y"},
    ).json()

    assert payload["total"] >= 5
    assert all(row["cap_band"] == "Mid Cap" for row in payload["rows"])
    assert payload["methodology"]["applied_filters"]["cap_bands"] == ["Mid Cap"]


def test_the_style_filter_narrows_the_universe(client):
    everything = client.get("/screen", params={"page_size": 1}).json()["total"]
    blend = client.get("/screen", params={"style": ["Blend"], "page_size": 200}).json()

    assert 0 < blend["total"] < everything
    assert all(row["style"] == "Blend" for row in blend["rows"])


def test_facets_list_every_value_not_just_a_sample(client):
    facets = client.get("/facets").json()

    assert set(facets) == {"sub_categories", "cap_bands", "styles", "amcs"}
    assert "Small Cap" in facets["cap_bands"]
    assert "Blend" in facets["styles"]
    # A facet list drives a filter, so a null must never reach it as an empty option.
    assert all(all(value for value in values) for values in facets.values())


def test_benchmarks_endpoint_reports_series_rules_and_coverage(client):
    payload = client.get("/benchmarks").json()
    assert payload["fund_currency"] == "INR"
    assert payload["benchmarks"][0]["benchmark_id"] == "NIFTY_MIDCAP150_TRI"
    assert payload["benchmarks"][0]["comparable_with_inr_funds"] is True
    assert payload["schemes_mapped"] + payload["schemes_unmapped"] >= payload["schemes_total"]
    assert any(rule["benchmark_id"] == "NIFTY50_TRI" for rule in payload["mapping_rules"])


def test_scheme_detail_states_benchmark_comparability(client):
    benchmark = client.get("/schemes/S01").json()["benchmark"]
    # The UI must be told, not left to compare currency strings itself.
    assert benchmark["comparable_with_inr_funds"] is True
    assert benchmark["fund_currency"] == "INR"


def test_importing_a_broken_benchmark_csv_is_a_client_error(client, tmp_path_factory):
    """A malformed file is the caller's problem to fix, so it must not read as a 500."""
    from mf_analytics.config import get_settings

    path = get_settings().mf_data_dir / "broken_benchmark.csv"
    path.write_text("date,benchmark_id,benchmark_name,total_return_index\n2024-01-31,X,X,100\n")
    response = client.post("/admin/import-benchmark", json={"file_path": str(path)})
    assert response.status_code == 422
    assert "currency" in response.json()["detail"]


def test_benchmark_csv_import_is_confined_to_the_data_directory(client):
    response = client.post("/admin/import-benchmark", json={"file_path": "/etc/passwd"})
    assert response.status_code == 400


def test_rolling_windows_are_published_for_one_three_five_and_ten_years(client):
    """A 1-year window still yields a long series, so it earns a column of its own."""
    payload = client.get("/columns").json()
    names = {m["name"] for m in payload["metrics"]}
    for h in (1, 3, 5, 10):
        assert f"rolling_{h}y_median" in names
    # The comparative and risk metrics deliberately stop at 3 years: 10 monthly
    # observations is too thin a sample to sort a screener on.
    assert "sharpe_1y" not in names
    assert "fund_minus_category_1y" not in names


def test_every_metric_carries_plain_english_metadata():
    """The guard that stops the next metric shipping as jargon only."""
    from mf_api.columns import NUMERIC_BY_NAME

    groups = {
        "Returns",
        "Rolling returns",
        "Vs similar funds",
        "Vs index",
        "Risk",
        "Drawdown",
        "Costs & terms",
        "Size",
        "Rank stability",
        "Fund basics",
    }
    for name, spec in NUMERIC_BY_NAME.items():
        assert spec.plain_label.strip(), f"{name} has no plain_label"
        assert spec.plain_definition.strip(), f"{name} has no plain_definition"
        assert spec.group in groups, f"{name} has group {spec.group!r}"


def test_starter_columns_are_all_selectable():
    from mf_api.columns import SELECTABLE, STARTER_COLUMNS

    assert set(STARTER_COLUMNS) <= SELECTABLE
    # Omit it and every blank cell loses the explanation this project exists to give.
    assert "missing_reasons" in STARTER_COLUMNS


def test_columns_endpoint_serves_the_starter_set_and_the_plain_fields(client):
    from mf_api.columns import DEFAULT_COLUMNS

    payload = client.get("/columns").json()

    assert payload["starter"][:2] == ["scheme_name", "scheme_code"]
    assert "cagr_5y" in payload["starter"]
    assert payload["default"] == list(DEFAULT_COLUMNS)
    for metric in payload["metrics"]:
        assert metric["plain_label"]
        assert metric["plain_definition"]
        assert metric["group"]


def test_behaviour_names_drawdown_episodes_with_their_recovery(client):
    payload = client.get("/schemes/S01/behaviour").json()

    assert payload["min_drawdown_depth"] == 0.10
    for episode in payload["drawdowns"]:
        assert episode["depth"] <= -0.10
        assert episode["peak_date"] < episode["trough_date"]
        # An open episode is kept, and says so with a null rather than by vanishing.
        if episode["recovered_date"] is not None:
            assert episode["trough_date"] <= episode["recovered_date"]
            assert episode["days_to_recover"] >= episode["days_to_trough"]
    # Worst first, so the episode that matters most does not need scrolling to.
    assert payload["drawdowns"] == sorted(payload["drawdowns"], key=lambda e: e["depth"])


def test_behaviour_reports_calendar_years_against_the_peer_group(client):
    payload = client.get("/schemes/S01/behaviour").json()
    years = payload["calendar_years"]

    assert years
    assert [y["year"] for y in years] == sorted(y["year"] for y in years)
    # A partial year is reported rather than dropped; the month count is what reveals it.
    assert all(1 <= y["months"] <= 12 for y in years)
    assert any(y["category_return"] is not None for y in years)


def test_behaviour_cost_compares_against_the_sub_category_median(client):
    cost = client.get("/schemes/S01/behaviour").json()["cost"]

    assert cost["horizon_years"] == 10
    if cost["expense_ratio"] is None:
        assert cost["reason"] == "ter_not_published"
        assert cost["shortfall_vs_median"] is None
    else:
        assert cost["difference"] == pytest.approx(cost["expense_ratio"] - cost["category_median"])


def test_behaviour_survives_a_scheme_with_no_expense_ratio_or_peer_history(client):
    """Every lookup here can legitimately match nothing, and none of them may be a 500."""
    response = client.get("/schemes/S12/behaviour")

    assert response.status_code == 200
    payload = response.json()
    assert payload["scheme_code"] == "S12"
    assert set(payload) >= {"drawdowns", "calendar_years", "capture", "cost"}


def test_screen_shows_one_row_per_fund_but_every_variant_when_asked(client):
    """T2.1's default universe, and the escape hatch from it.

    S01, S07 and S08 are the Direct Growth, Regular and IDCW codes of one fund. The
    default must show one of them; turning the toggle off must show all three, because
    the variants are still real rows a user may need to see.
    """
    # No "limit" here: /screen pages with page_size, and the stray parameter this
    # query used to carry was silently ignored rather than honoured or refused.
    query = {"plan": ["Direct", "Regular"], "option": ["Growth", "IDCW Payout"]}

    deduped = client.get("/screen", params={**query, "page_size": 100}).json()["rows"]
    expanded = client.get(
        "/screen", params={**query, "page_size": 100, "dedupe_families": "false"}
    ).json()["rows"]

    family = {"S01", "S07", "S08"}
    assert len(family & {r["scheme_code"] for r in deduped}) == 1
    assert family <= {r["scheme_code"] for r in expanded}


def test_metadata_counts_funds_separately_from_scheme_codes(client):
    """T2.1: the dashboard must not present scheme codes as the number of funds.

    The fixture's three Alpha Mid Cap rows (Direct Growth, Regular, IDCW) are one fund,
    so the family count has to be lower than the code count by exactly those extras.
    """
    counts = client.get("/metadata").json()["counts"]

    # 15 codes, of which S01/S07/S08 are one fund: 13 funds, a drop of exactly 2.
    assert counts["scheme_master"] == len(SCHEMES)
    assert counts["fund_families"] == counts["scheme_master"] - 2


def test_behaviour_capture_equals_the_snapshot_for_a_fixture_fund(client):
    """T1.3's acceptance criterion: the live endpoint and the snapshot must agree.

    They did not. The endpoint measured capture against the whole-category average
    including the fund itself, while the snapshot leaves the fund out of its own peer
    average, so the same fund showed two different capture numbers depending on which
    screen you were looking at.
    """
    payload = client.get("/schemes/S01/behaviour").json()
    row = client.get("/schemes/S01/metrics").json()

    real = payload["capture_by_horizon"]["3y"]["up"]
    assert real is not None, "fixture must exercise a real capture value, not two nulls"
    assert payload["capture_peer_basis"] == "leave_one_out_category_average"
    assert payload["capture"]["horizon_years"] == 3
    for horizon, capture in payload["capture_by_horizon"].items():
        years = int(horizon.removesuffix("y"))
        assert capture["up"] == pytest.approx(row[f"upside_capture_{years}y"], nan_ok=True)
        assert capture["down"] == pytest.approx(row[f"downside_capture_{years}y"], nan_ok=True)
    # The 3y pair the UI reads is the same object as the 3y entry, not a second lookup.
    assert payload["capture"]["up"] == payload["capture_by_horizon"]["3y"]["up"]


def test_behaviour_capture_is_named_missing_for_a_fund_with_no_snapshot_row(client):
    capture = client.get("/schemes/S12/behaviour").json()["capture"]

    if capture["up"] is None:
        assert capture["reason"], "a null capture must say why, never a bare null"


def test_behaviour_404s_for_an_unknown_scheme(client):
    assert client.get("/schemes/NOPE/behaviour").status_code == 404


def test_exposure_refuses_when_no_style_basis_is_loaded(client):
    """Benchmark data ships empty, so this must name the gap rather than invent a fit."""
    payload = client.get("/schemes/S01/exposure").json()

    assert payload["weights"] == []
    assert payload["basis"] == []
    assert payload["reason"] == "benchmark_unavailable"
    assert "not from holdings" in payload["caveat"]


def test_exposure_fits_a_loaded_style_basis(client):
    """With a basis present, an index-like fund must be describable by it."""
    from mf_analytics.ingest.benchmarks import STYLE_FACTOR_CLASS, build_index_fund_proxy
    from mf_api import store

    store.close_connection()
    build_index_fund_proxy(
        "S01",
        "TEST_FACTOR",
        "Test factor",
        asset_class=STYLE_FACTOR_CLASS,
        settings=store.get_settings(),
    )

    payload = client.get("/schemes/S01/exposure").json()

    assert [b["benchmark_id"] for b in payload["basis"]] == ["TEST_FACTOR"]
    # S01 is the very series the factor was built from, so it must fit it perfectly.
    assert payload["r_squared"] == pytest.approx(1.0, abs=1e-6)
    assert payload["weights"][0]["benchmark_id"] == "TEST_FACTOR"
    assert payload["weights"][0]["weight"] == pytest.approx(1.0, abs=1e-6)


def test_exposure_404s_for_an_unknown_scheme(client):
    assert client.get("/schemes/NOPE/exposure").status_code == 404


def test_screen_refuses_an_unknown_query_parameter(client):
    """A misspelled filter must not answer as though the screen were unfiltered.

    `styles` is the plural of the real `style`. Starlette drops it silently, so the
    request came back as the whole universe ranked by whatever sort was asked for,
    which is indistinguishable from a successful screen.
    """
    response = client.get("/screen", params={"styles": "Momentum"})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "styles" in detail
    assert "style" in detail  # the accepted spelling is named


def test_screen_still_accepts_range_parameters_it_does_not_declare(client):
    """Range bounds are read off the raw query string, so the guard must let them by."""
    assert client.get("/screen", params={"cagr_3y_min": 0.05}).status_code == 200
    # And an unknown metric is still rejected by parse_ranges, with its own 400 rather
    # than the middleware's 422: the guard must let range keys reach that check.
    bad = client.get("/screen", params={"not_a_metric_min": 1})
    assert bad.status_code == 400
    assert "not_a_metric" in bad.json()["detail"]


def test_search_leads_with_the_direct_growth_variant(client):
    """Relevance alone interleaved one fund's plans and led with IDCW.

    A person searching a fund name almost always wants the Direct Growth plan; the
    other variants stay in the list, directly beneath it.
    """
    items = client.get("/search", params={"q": "Alpha Bluechip"}).json()["items"]
    assert items, "fixture fund should be found"
    first = items[0]
    assert (first["clean_plan"], first["clean_option"]) == ("Direct", "Growth")


def test_search_respects_a_query_that_names_a_variant(client):
    """Asking for "regular" must not still be answered with the Direct Growth row."""
    items = client.get("/search", params={"q": "Alpha Bluechip Regular"}).json()["items"]
    assert items
    assert any(i["clean_plan"] == "Regular" for i in items)
