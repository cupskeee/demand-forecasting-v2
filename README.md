# Demand Forecasting v2

A demand forecasting app that runs entirely on the visitor's own device. You add monthly
sales as a CSV file, and four models are fitted in your browser: XGBoost, SARIMAX,
Elastic Net and Holt-Winters. The server only hands out static files. There is no
backend, no account, and nothing you import or produce is sent anywhere.

Live at <https://demand-forecasting-v2.yusuframadhan.dev>. A portfolio project by
[Yusuf Ramadhan](https://yusuframadhan.com).

## What it does

1. **Install.** The first visit downloads "Rama's ML Engine" (about 50 MB) into the
   browser, checks every file against a published checksum, and keeps it for next time.
   After that the app opens straight away and works with the network off.
2. **Datasets.** Import a CSV, or open one of four built-in examples. Data is stored in
   the browser's IndexedDB.
3. **Columns and checks.** The app proposes the month column, the sales column and the
   external factors, then reports problems in plain words: missing or duplicate months,
   values that are not numbers, too little history.
4. **Run.** All four models are back-tested and fitted in background workers, with live
   progress. Quick mode tests each model once; thorough mode uses several rolling
   windows.
5. **Results.** The best model (lowest MAPE on held-back months) first, a chart of
   history, back-test and forecast, and a table comparing all four on MAE, RMSE, MAPE
   and R².
6. **What-if.** Change the future values of the external factors, for example price up
   5 percent, and compare the result with the baseline on any of the four models.
7. **Run history.** Finished runs are kept locally and can be reopened or deleted.

One dataset holds one sales series: one row per month.

## The engine, and the proof it is harmless

Rama's ML Engine is a name for a bundle of open-source projects. It is built on
[Pyodide](https://pyodide.org) (Python compiled to WebAssembly),
[scikit-learn](https://scikit-learn.org), [statsmodels](https://www.statsmodels.org),
[XGBoost](https://xgboost.ai), [pandas](https://pandas.pydata.org) and
[NumPy](https://numpy.org). All of the forecasting is done by those projects.

- [`public/engine/manifest.json`](public/engine/manifest.json) lists every file the
  engine downloads: path, size, SHA-256 checksum, the project and version it came from,
  its licence and the upstream address.
- [`tools/build-engine.mjs`](tools/build-engine.mjs) rebuilds the engine folder and the
  manifest from the upstream Pyodide release. It needs only Node, and it checks each
  package against the checksum Pyodide itself publishes. Run it and compare:

  ```sh
  node tools/build-engine.mjs          # download and write the manifest
  node tools/build-engine.mjs --check  # verify the files against the committed manifest
  git diff public/engine/manifest.json # no output means identical
  ```

- The engine files are served from the site itself, not from a CDN. The app hashes each
  one in the browser and compares it with the manifest before first use, and can verify
  the installed copies again from the Engine page.
- The engine runs inside the browser's sandbox, in Web Workers. It cannot read files or
  install anything. The site's Content-Security-Policy
  ([`public/_headers`](public/_headers)) forbids connections to any other host.
- Licence texts of every bundled project are in [`public/licenses`](public/licenses) and
  on the app's licences page.
- The Engine page has one control that removes the engine and all local data.

## How the models are set up

The model code is one Python file, [`src/engine/forecast_engine.py`](src/engine/forecast_engine.py).

| Model | How it is used here |
| --- | --- |
| XGBoost | Learns the change from the same month a year earlier, from month of year and the year-on-year change in each factor. |
| SARIMAX | Seasonal ARIMA with the factors as regressors. Thorough mode searches a small grid of orders by AIC. |
| Elastic Net | Regularised regression on trend, month of year and the factors; the penalty is chosen by time-series cross-validation. |
| Holt-Winters | Exponential smoothing on the sales history. When the dataset has external factors it is fitted in two parts: a linear regression estimates the effect of the factors, Holt-Winters forecasts what the regression leaves over, and the forecast is the two added together. That is what lets it answer a what-if. |

Future values of the factors come from the file when it has rows after the last month of
sales. Otherwise each factor either holds its last value or repeats the same month last
year, whichever would have predicted its own recent history better.

## Run it locally

Needs Node 20 or later.

```sh
npm install
npm run engine     # fetch the engine files into public/engine (about 50 MB)
npm run dev        # http://localhost:5173
npm run build      # type-check and build into dist/
npm run preview    # serve dist/ with the production security headers
```

The engine proof page from the first step of the build is kept in [`spike/`](spike):
`node tools/serve.mjs`, then open <http://localhost:4173/spike/>.

## Example datasets

The four examples in [`public/examples`](public/examples) are fictional and brand-free.
They are generated by [`tools/generate_examples.py`](tools/generate_examples.py) with
fixed seeds, using only the Python standard library:

```sh
uv run tools/generate_examples.py
```

## Deployment

Static assets on Cloudflare (see [`wrangler.jsonc`](wrangler.jsonc)). The largest engine
file is 14 MB, under Cloudflare's 25 MiB limit per static asset.
