from __future__ import annotations
import json, sys
from datetime import date, datetime, timedelta, timezone
from typing import Any
import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

AssetTuple = tuple[str, str, str]  # (display_name, ticker, group)

ASSETS: list[AssetTuple] = [
    # g1 — US representative ETFs
    ("TLT", "TLT", "g1"),
    ("GLD", "GLD", "g1"),
    ("IBIT", "IBIT", "g1"),
    ("SPY", "SPY", "g1"),
    ("QQQ", "QQQ", "g1"),
    # g2 — Korean overseas ETFs + US large-cap tech
    ("TIGER 미국S&P500", "360750.KS", "g2"),
    ("KODEX 미국S&P500TR", "379800.KS", "g2"),
    ("ACE 미국나스닥100", "367380.KS", "g2"),
    ("SOL 미국배당다우존스", "446720.KS", "g2"),
    ("NVDA", "NVDA", "g2"),
    ("GOOGL", "GOOGL", "g2"),
    ("AAPL", "AAPL", "g2"),
    ("MSFT", "MSFT", "g2"),
    ("AMZN", "AMZN", "g2"),
    ("META", "META", "g2"),
    ("AVGO", "AVGO", "g2"),
    ("TSLA", "TSLA", "g2"),
    ("NFLX", "NFLX", "g2"),
    ("PLTR", "PLTR", "g2"),
    ("CSCO", "CSCO", "g2"),
    # g3 — Korean market
    ("KODEX 200", "069500.KS", "g3"),
    ("KODEX 코스닥150", "229200.KS", "g3"),
    ("KODEX 반도체", "091160.KS", "g3"),
    ("TIGER 반도체", "091230.KS", "g3"),
    ("SOL 반도체소부장Fn", "455850.KS", "g3"),
    ("ACE 반도체TOP4Plus솔루션", "456600.KS", "g3"),
    ("삼성전자", "005930.KS", "g3"),
    ("SK하이닉스", "000660.KS", "g3"),
    ("한미반도체", "042700.KS", "g3"),
    ("리노공업", "058470.KS", "g3"),
]

WINDOWS: list[int] = list(range(10, 201, 10))  # [10, 20, ..., 200]
N_BUCKETS: int = 20
KST = timezone(timedelta(hours=9))
DATA_START: str = "2023-01-01"
WEEKLY_CUTOFF: date = date(2025, 1, 6)
EXCLUDE_DATES: frozenset[str] = frozenset({"2025-12-31", "2025-12-30", "2025-12-29"})
OUTPUT_PATH: str = "trend_data.json"


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

def compute_vwap(df_window: pd.DataFrame) -> float:
    lo = df_window["low"].min()
    hi = df_window["high"].max()

    if hi == lo:
        return float(df_window["close"].mean())

    bsize = (hi - lo) / N_BUCKETS
    bucket_prices = np.array([lo + (b + 0.5) * bsize for b in range(N_BUCKETS)])
    bvol = np.zeros(N_BUCKETS)

    for _, row in df_window.iterrows():
        high, low, close, volume = row["high"], row["low"], row["close"], row["volume"]
        mu = (high + low + close) / 3
        sigma = (high - low) / 4

        if sigma == 0:
            idx = min(N_BUCKETS - 1, int((mu - lo) / bsize))
            bvol[idx] += volume
        else:
            weights = norm.pdf(bucket_prices, mu, sigma)
            total_w = weights.sum()
            if total_w == 0:
                continue
            bvol += volume * (weights / total_w)

    total_vol = bvol.sum()
    if total_vol == 0:
        return float(df_window["close"].iloc[-1])

    return float(np.sum(bucket_prices * bvol) / total_vol)


def compute_vwap_series(df: pd.DataFrame, window: int = 20) -> list[float | None]:
    vwaps: list[float | None] = []
    for i in range(len(df)):
        if i < window:
            vwaps.append(None)
        else:
            vwaps.append(compute_vwap(df.iloc[i - window : i]))
    return vwaps


def strength_score(arr: list[float | None], norm_window: int = 52) -> list[float | None]:
    scores: list[float | None] = []
    for i in range(len(arr)):
        val = arr[i]
        if val is None or (isinstance(val, float) and np.isnan(val)):
            scores.append(None)
            continue

        lookback = arr[max(0, i - norm_window) : i + 1]
        valid = [v for v in lookback if v is not None and not (isinstance(v, float) and np.isnan(v))]

        if len(valid) < 5:
            scores.append(None)
            continue

        count_le = sum(1 for v in valid if v <= val)
        pct = count_le / len(valid)
        score = round((pct * 2 - 1) * 100, 1)
        scores.append(score)

    return scores


def download_ohlcv(ticker: str, end_date: str) -> pd.DataFrame:
    raw = yf.download(
        ticker,
        start=DATA_START,
        end=end_date,
        interval="1d",
        auto_adjust=True,
        progress=False,
    )
    raw.columns = [c[0].lower() if isinstance(c, tuple) else c.lower() for c in raw.columns]
    return raw[["open", "high", "low", "close", "volume"]].dropna().copy()


def build_vwap_structure(df: pd.DataFrame) -> tuple[list[dict[str, Any]], float | None]:
    structure: list[dict[str, Any]] = []
    base_vwap: float | None = None

    for w in WINDOWS:
        if len(df) >= w:
            vwap = round(compute_vwap(df.iloc[-w:]), 4)
        else:
            vwap = None
        if w == 200:
            base_vwap = vwap
        structure.append({"window": w, "vwap": vwap})

    if base_vwap:
        for entry in structure:
            if entry["vwap"] is not None:
                entry["norm"] = round(entry["vwap"] / base_vwap * 100, 2)
            else:
                entry["norm"] = None

    return structure, base_vwap


def build_weekly_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    vwap_series = compute_vwap_series(df, window=20)
    df = df.copy()
    df["vwap"] = vwap_series
    df["vwap_prev5"] = df["vwap"].shift(5)

    weekly_chg_list: list[float | None] = []
    for _, row in df.iterrows():
        v = row["vwap"]
        vp = row["vwap_prev5"]
        if v is not None and vp is not None and not np.isnan(v) and not np.isnan(vp) and vp != 0:
            weekly_chg_list.append((v - vp) / vp * 100)
        else:
            weekly_chg_list.append(None)

    df["weekly_chg"] = weekly_chg_list
    df["date"] = df.index
    df["week"] = df["date"].apply(lambda d: d.isocalendar()[1])
    df["year"] = df["date"].apply(lambda d: d.isocalendar()[0])

    weekly = df.groupby(["year", "week"]).last()
    weekly_chg_values = weekly["weekly_chg"].tolist()
    scores = strength_score(weekly_chg_values)
    weekly["score"] = scores

    records: list[dict[str, Any]] = []
    for _, row in weekly.iterrows():
        d = row["date"]
        date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]

        if date.fromisoformat(date_str) < WEEKLY_CUTOFF:
            continue
        if date_str in EXCLUDE_DATES:
            continue

        rec: dict[str, Any] = {
            "date": date_str,
            "price": round(float(row["close"]), 2),
        }
        if row["score"] is not None:
            rec["score"] = row["score"]
        else:
            rec["score"] = None
        records.append(rec)

    return records


def process_asset(name: str, ticker: str, group: str, end_date: str) -> dict[str, Any] | None:
    try:
        df = download_ohlcv(ticker, end_date)
    except Exception as e:
        print(f"ERROR downloading {name} ({ticker}): {e}", file=sys.stderr)
        return None

    if df.empty:
        print(f"WARNING: empty data for {name} ({ticker})", file=sys.stderr)
        return None

    vwap_structure, base_vwap = build_vwap_structure(df)
    records = build_weekly_records(df)

    # Debug output
    norm_200 = next((s["norm"] for s in vwap_structure if s["window"] == 200 and s.get("norm") is not None), None)
    norm_10 = next((s["norm"] for s in vwap_structure if s["window"] == 10 and s.get("norm") is not None), None)
    print(f"  {name}: 200d norm={norm_200}, 10d norm={norm_10}")

    return {
        "ticker": ticker,
        "group": group,
        "records": records,
        "vwap_structure": vwap_structure,
        "latest_price": round(float(df["close"].iloc[-1]), 2),
    }


def main() -> None:
    run_time = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    end_date = datetime.now(KST).strftime("%Y-%m-%d")

    result: dict[str, Any] = {"_meta": {"updated_at": run_time}}
    failed: list[str] = []

    for name, ticker, group in ASSETS:
        asset_data = process_asset(name, ticker, group, end_date)
        if asset_data is not None:
            result[name] = asset_data
        else:
            failed.append(name)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"Done. Wrote {OUTPUT_PATH} ({len(result) - 1} assets)")

    if failed:
        print(f"WARNING: {len(failed)} assets failed: {failed}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
