# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Generates the four built-in example datasets.

    uv run tools/generate_examples.py

Everything here is made up: fictional, brand-free products in an Indonesian market
setting. Fixed seeds make the output identical on every run. Each file holds one
monthly sales series plus external factors, and ends with twelve future months
that carry planned factor values but no sales.
"""

import csv
import json
import math
import random
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "public" / "examples"
FUTURE_MONTHS = 12

# Eid al-Fitr. The fasting month before it and the week after drive a festive peak
# that moves about eleven days earlier every year.
EID = [
    date(2015, 7, 17), date(2016, 7, 6), date(2017, 6, 25), date(2018, 6, 15),
    date(2019, 6, 5), date(2020, 5, 24), date(2021, 5, 13), date(2022, 5, 2),
    date(2023, 4, 22), date(2024, 4, 10), date(2025, 3, 31), date(2026, 3, 20),
    date(2027, 3, 10),
]
FESTIVE = set()
for eid in EID:
    for offset in range(-29, 7):
        FESTIVE.add(eid + timedelta(days=offset))


def months(start_year, count):
    return [(start_year + i // 12, i % 12 + 1) for i in range(count)]


def festive_days(year, month):
    day, total = date(year, month, 1), 0
    while day.month == month:
        total += day in FESTIVE
        day += timedelta(days=1)
    return total


def round_to(value, step):
    return int(round(value / step) * step)


def write(name, header, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / f"{name}.csv", "w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)


# ----------------------------------------------------------------- clove cigarettes

def clove_cigarettes():
    rng = random.Random(1101)
    excise_by_year = {2016: 480, 2017: 530, 2018: 590, 2019: 590, 2020: 740, 2021: 865,
                      2022: 985, 2023: 1101, 2024: 1231, 2025: 1231, 2026: 1330}
    season = [-0.03, -0.05, 0.00, 0.01, 0.02, 0.03, 0.02, 0.01, -0.01, 0.00, 0.01, 0.03]
    all_months = months(2016, 120 + FUTURE_MONTHS)
    rows, outlets, price, drift = [], 182.0, 14800.0, 0.0
    for i, (year, month) in enumerate(all_months):
        future = i >= 120
        excise = excise_by_year[year]
        rise = excise / excise_by_year.get(year - 1, excise) - 1
        passed_on = (excise - excise_by_year.get(year - 1, excise)) * 12 * 1.1
        # Price follows the excise: most of the rise in January, the rest mid-year.
        if month == 1 and i:
            price += 0.7 * passed_on + 0.012 * price
        if month == 7:
            price += 0.3 * passed_on + 0.008 * price
        outlets += 0.45 + (0 if future else rng.gauss(0, 0.5))
        # Shelf price drifts around the list price as retailers and rivals move.
        drift = 0.0 if future else 0.6 * drift + rng.gauss(0, 0.022)
        shelf = price * (1 + drift)
        promo = 0 if future else (round_to(rng.uniform(250, 900), 10) if rng.random() < 0.3 else round_to(rng.uniform(40, 160), 10))
        fest = festive_days(year, month)
        real_price = shelf / (14800 * 1.055 ** (i / 12))
        log_sales = (
            math.log(1480) + 0.012 * min(i, 48) / 12 - 0.022 * max(i - 48, 0) / 12
            + season[month - 1] - 0.75 * math.log(real_price) + 0.11 * fest / 30
            + 0.5 * math.log(outlets / 182) + 0.035 * math.log1p(promo / 100)
        )
        # Trade stocks up in December before an excise rise, and buys less in January.
        next_rise = excise_by_year.get(year + 1, excise) / excise - 1
        if month == 12:
            log_sales += 0.35 * next_rise
        if month == 1:
            log_sales -= 0.3 * rise
        sales = math.exp(log_sales + rng.gauss(0, 0.022))
        rows.append([
            f"{year}-{month:02d}", "" if future else round(sales, 1), round_to(shelf, 100), excise,
            fest, "" if future else round(outlets, 1), "" if future else promo,
        ])
    rows = [r for r in rows if r[0] != "2018-09"]  # one month never made it into the file
    header = ["month", "sales_million_sticks", "retail_price_idr", "excise_idr_per_stick",
              "festive_days", "outlets_thousand", "promo_spend_idr_million"]
    write("clove-cigarettes", header, rows)
    return {
        "id": "clove-cigarettes",
        "name": "Clove cigarettes, filter 12s",
        "category": "Tobacco",
        "description": "Ten years of monthly sales for a fictional clove cigarette pack, with retail price, excise, the festive calendar, outlet coverage and promotion spend.",
        "quirks": [
            "Excise rises most Januaries: the trade stocks up in December and buys less in January.",
            "September 2018 is missing from the file.",
            "2026 rows carry the planned price, the announced excise and the festive calendar.",
        ],
        "mapping": {"date": "month", "target": "sales_million_sticks", "factors": header[2:]},
        "suggestion": {"label": "Raise the retail price by 5%", "factor": "retail_price_idr", "kind": "percent", "value": 5},
    }


# ----------------------------------------------------------------- white cigarettes

def white_cigarettes():
    rng = random.Random(2202)
    excise_by_year = {2017: 555, 2018: 625, 2019: 625, 2020: 790, 2021: 935, 2022: 1065,
                      2023: 1193, 2024: 1336, 2025: 1336, 2026: 1440}
    season = [-0.02, -0.04, 0.00, 0.00, 0.01, 0.02, 0.03, 0.02, -0.01, -0.01, 0.00, 0.02]
    pandemic = {(2020, 4): -0.19, (2020, 5): -0.14, (2020, 6): -0.08, (2020, 7): -0.04}
    all_months = months(2017, 108 + FUTURE_MONTHS)
    rows, price, confidence, drift = [], 21500.0, 121.0, 0.0
    for i, (year, month) in enumerate(all_months):
        future = i >= 108
        excise = excise_by_year[year]
        rise = excise / excise_by_year.get(year - 1, excise) - 1
        passed_on = (excise - excise_by_year.get(year - 1, excise)) * 20 * 1.1
        if month == 1 and i:
            price += 0.75 * passed_on + 0.015 * price
        if month == 8:
            price += 0.25 * passed_on + 0.006 * price
        drift = 0.0 if future else 0.6 * drift + rng.gauss(0, 0.02)
        shelf = price * (1 + drift)
        target_confidence = 82 if (year, month) in pandemic else (96 if year == 2020 and month > 7 else 120)
        confidence += 0.45 * (target_confidence - confidence) + (0 if future else rng.gauss(0, 1.6))
        promo = 0 if future else (round_to(rng.uniform(300, 1100), 10) if rng.random() < 0.25 else round_to(rng.uniform(30, 120), 10))
        fest = festive_days(year, month)
        real_price = shelf / (21500 * 1.05 ** (i / 12))
        log_sales = (
            math.log(640) - 0.038 * i / 12 + season[month - 1] - 0.95 * math.log(real_price)
            + 0.07 * fest / 30 + 0.55 * math.log(confidence / 120) + 0.03 * math.log1p(promo / 100)
            + pandemic.get((year, month), 0) * 0.5
        )
        next_rise = excise_by_year.get(year + 1, excise) / excise - 1
        if month == 12:
            log_sales += 0.3 * next_rise
        if month == 1:
            log_sales -= 0.3 * rise
        sales = math.exp(log_sales + rng.gauss(0, 0.026))
        rows.append([
            f"{year}-{month:02d}", "" if future else round(sales, 1), round_to(shelf, 100), excise,
            fest, "" if future else round(confidence, 1), "" if future else promo,
        ])
    header = ["month", "sales_million_sticks", "retail_price_idr", "excise_idr_per_stick",
              "festive_days", "consumer_confidence_index", "promo_spend_idr_million"]
    write("white-cigarettes", header, rows)
    return {
        "id": "white-cigarettes",
        "name": "White cigarettes, 20s",
        "category": "Tobacco",
        "description": "Nine years of monthly sales for a fictional white cigarette pack in a slowly shrinking segment, with price, excise, the festive calendar, consumer confidence and promotion spend.",
        "quirks": [
            "A 26% excise rise in January 2020 pushes the price up sharply.",
            "Sales and consumer confidence both drop in April to July 2020.",
            "2026 rows carry the planned price, the announced excise and the festive calendar.",
        ],
        "mapping": {"date": "month", "target": "sales_million_sticks", "factors": header[2:]},
        "suggestion": {"label": "Consumer confidence falls 10 points", "factor": "consumer_confidence_index", "kind": "add", "value": -10},
    }


# ----------------------------------------------------------------- instant noodles

def instant_noodles():
    rng = random.Random(3303)
    season = [0.04, 0.02, 0.00, -0.02, -0.03, -0.02, 0.00, -0.01, -0.02, 0.00, 0.02, 0.05]
    rain_normal = [330, 290, 240, 170, 120, 80, 60, 55, 70, 130, 220, 300]
    school_holiday = [3, 0, 2, 0, 0, 14, 12, 0, 0, 0, 0, 12]
    all_months = months(2015, 132 + FUTURE_MONTHS)
    rows, price, wheat = [], 2300.0, 100.0
    for i, (year, month) in enumerate(all_months):
        future = i >= 132
        wheat_target = 100 + 6 * (i / 12) + (38 if (2022, 3) <= (year, month) <= (2023, 2) else 0)
        wheat += 0.3 * (wheat_target - wheat) + (0 if future else rng.gauss(0, 1.8))
        if month in (2, 9) and price < 2300 * (wheat / 100) * 0.98:
            price += 100
        promo = 0 if future else (rng.choice([10, 15, 20]) if rng.random() < 0.28 else 0)
        rain = rain_normal[month - 1] * (1 + rng.gauss(0, 0.22))
        fest = festive_days(year, month)
        real_price = price / (2300 * 1.035 ** (i / 12))
        log_sales = (
            math.log(880) + 0.043 * i / 12 + season[month - 1] - 0.55 * math.log(real_price)
            + 0.016 * promo + 0.16 * fest / 30 + 0.00022 * (rain - rain_normal[month - 1])
            + 0.002 * school_holiday[month - 1]
        )
        if (year, month) == (2020, 3):
            log_sales += 0.30  # households stocked up
        if (year, month) == (2020, 4):
            log_sales += 0.10
        sales = math.exp(log_sales + rng.gauss(0, 0.024))
        rows.append([
            f"{year}-{month:02d}", "" if future else round(sales, 1), int(price), promo if not future else "",
            fest, "" if future else round(rain), "" if future else round(wheat, 1),
            school_holiday[month - 1],
        ])
    rows = [r for r in rows if r[0] != "2022-07"]
    header = ["month", "sales_thousand_cartons", "price_idr_per_pack", "promo_depth_pct",
              "festive_days", "rainfall_mm", "wheat_cost_index", "school_holiday_days"]
    write("instant-noodles", header, rows)
    return {
        "id": "instant-noodles",
        "name": "Instant noodles, fried 85 g",
        "category": "Food",
        "description": "Eleven years of monthly sales for a fictional instant noodle pack, with shelf price, promotion depth, the festive calendar, rainfall, wheat cost and school holidays.",
        "quirks": [
            "Households stocked up in March 2020: a one-off spike no factor explains.",
            "July 2022 is missing from the file.",
            "The festive peak moves from July in 2015 to March in 2025.",
        ],
        "mapping": {"date": "month", "target": "sales_thousand_cartons", "factors": header[2:]},
        "suggestion": {"label": "Add a 10-point promotion every month", "factor": "promo_depth_pct", "kind": "add", "value": 10},
    }


# ----------------------------------------------------------------- bottled tea

def bottled_tea():
    rng = random.Random(4404)
    season = [-0.02, -0.03, 0.00, 0.01, 0.02, 0.01, 0.02, 0.04, 0.05, 0.04, 0.00, 0.03]
    temp_normal = [27.0, 27.1, 27.5, 28.0, 28.3, 28.0, 27.8, 28.1, 28.6, 28.9, 28.3, 27.5]
    lockdown = {(2020, 4): -0.24, (2020, 5): -0.20, (2020, 6): -0.10, (2021, 7): -0.12, (2021, 8): -0.06}
    all_months = months(2018, 96 + FUTURE_MONTHS)
    rows, coolers = [], 41.0
    for i, (year, month) in enumerate(all_months):
        future = i >= 96
        price = 4000 if (year, month) < (2022, 7) else 4500  # one list-price change
        if (year, month) >= (2025, 2):
            price = 4800
        coolers += 0.55 + (0 if future else rng.gauss(0, 0.4))
        temp = temp_normal[month - 1] + rng.gauss(0, 0.45)
        promo = 0 if future else (round_to(rng.uniform(200, 700), 10) if rng.random() < 0.3 else round_to(rng.uniform(20, 90), 10))
        fest = festive_days(year, month)
        log_sales = (
            math.log(410) + 0.03 * i / 12 + season[month - 1] - 1.1 * math.log(price / 4000)
            + 0.36 * fest / 30 + 0.045 * (temp - temp_normal[month - 1])
            + 0.6 * math.log(coolers / 41) + 0.04 * math.log1p(promo / 100)
            + lockdown.get((year, month), 0)
        )
        sales = math.exp(log_sales + rng.gauss(0, 0.028))
        value = "" if future else round(sales, 1)
        if (year, month) == (2021, 2):
            value = "n/a"  # a cell someone left as text
        rows.append([
            f"{year}-{month:02d}", value, price, "" if future else round(temp, 1), fest,
            "" if future else promo, "" if future else round(coolers, 1),
        ])
    header = ["month", "sales_thousand_cases", "price_idr_per_bottle", "avg_temperature_c",
              "festive_days", "promo_spend_idr_million", "cooler_outlets_thousand"]
    write("bottled-tea", header, rows)
    return {
        "id": "bottled-tea",
        "name": "Bottled jasmine tea, 350 ml",
        "category": "Beverage",
        "description": "Eight years of monthly sales for a fictional ready-to-drink tea, with list price, temperature, the festive calendar, promotion spend and the number of outlets with a cooler.",
        "quirks": [
            "The fasting month lifts sales by a third, and it moves from May and June in 2018 to March in 2025.",
            "The list price changed in July 2022 and again in February 2025.",
            "February 2021 holds the text \"n/a\" instead of a number.",
        ],
        "mapping": {"date": "month", "target": "sales_thousand_cases", "factors": header[2:]},
        "suggestion": {"label": "Cut the list price by 5%", "factor": "price_idr_per_bottle", "kind": "percent", "value": -5},
    }


def main():
    index = []
    for build in (clove_cigarettes, white_cigarettes, instant_noodles, bottled_tea):
        entry = build()
        with open(OUT / f"{entry['id']}.csv") as handle:
            rows = list(csv.reader(handle))[1:]
        history = [r for r in rows if r[1] != ""]
        entry["file"] = f"{entry['id']}.csv"
        entry["months"] = len(history)
        entry["from"], entry["to"] = history[0][0], history[-1][0]
        index.append(entry)
        print(f"{entry['id']}: {len(history)} months, {len(rows[0]) - 2} factors")
    with open(OUT / "index.json", "w") as handle:
        json.dump(index, handle, indent=2)
        handle.write("\n")


if __name__ == "__main__":
    main()
