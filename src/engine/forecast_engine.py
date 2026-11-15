"""Forecasting models for Rama's ML Engine.

Runs inside Pyodide, in a Web Worker. Four models share one interface:

    model = SomeModel()
    model.fit(y, X, m0, opts, report)   # y: sales history, X: external factors
    mean, lower, upper = model.predict(X_future, steps)

`m0` is the calendar month (0 = January) of the first observation. `opts` carries
the mode ("quick" or "thorough") and, on a refit, the settings chosen earlier, so a
refit reproduces the same model. `report(fraction, message)` sends live progress.
"""

import math
import time
import warnings

import numpy as np

SEASON = 12
Z80 = 1.2816  # half-width of an 80% interval, in standard deviations


# ---------------------------------------------------------------- helpers


class Scaler:
    """Standardises external factors and drops ones that never change."""

    def __init__(self, X):
        X = np.asarray(X, float).reshape(len(X), -1)
        sd = X.std(axis=0) if X.shape[1] else np.array([])
        self.keep = np.where(sd > 1e-12)[0]
        self.mu = X[:, self.keep].mean(axis=0) if len(self.keep) else np.array([])
        self.sd = sd[self.keep]
        self.k = len(self.keep)

    def __call__(self, X):
        X = np.asarray(X, float).reshape(len(X), -1)
        if not self.k:
            return np.zeros((len(X), 0))
        return (X[:, self.keep] - self.mu) / self.sd

    def spread(self, values):
        """Puts per-kept-column values back into the original column order."""
        out = [0.0] * (int(self.keep.max()) + 1 if self.k else 0)
        for i, col in enumerate(self.keep):
            out[int(col)] = float(values[i])
        return out


def month_of(idx, m0):
    return (m0 + np.asarray(idx)) % SEASON


def month_dummies(idx, m0):
    month = month_of(idx, m0)
    return (month[:, None] == np.arange(1, SEASON)[None, :]).astype(float)


def metrics(actual, predicted):
    a = np.asarray(actual, float)
    p = np.asarray(predicted, float)
    err = a - p
    nonzero = a != 0
    spread = float(np.sum((a - a.mean()) ** 2))
    return {
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err**2))),
        "mape": float(np.mean(np.abs(err[nonzero] / a[nonzero])) * 100) if nonzero.any() else None,
        "r2": float(1 - np.sum(err**2) / spread) if spread > 0 else None,
    }


def average_metrics(rows):
    out = {}
    for key in ("mae", "rmse", "mape", "r2"):
        values = [r[key] for r in rows if r[key] is not None]
        out[key] = float(np.mean(values)) if values else None
    return out


# ---------------------------------------------------------------- XGBoost


class XGBoostModel:
    """Gradient-boosted trees.

    With 30 or more months it learns the change from the same month a year earlier,
    from the year-on-year change in each external factor. That lets trees follow a
    trend and respond to factor values outside the range they were trained on.
    With less history it removes a straight-line trend and learns what is left.
    """

    def fit(self, y, X, m0, opts, report):
        import xgboost as xgb

        n = len(y)
        self.n, self.m0, self.y, self.X = n, m0, y, X
        self.yoy = n >= 30
        idx = np.arange(n)
        if self.yoy:
            target = y[SEASON:] - y[:-SEASON]
            feats = self._features(idx[SEASON:], X[SEASON:], X[:-SEASON])
        else:
            design = np.c_[np.ones(n), idx]
            self.trend = np.linalg.lstsq(design, y, rcond=None)[0]
            target = y - design @ self.trend
            feats = self._features(idx, X, None)

        rounds = 150 if opts["mode"] == "quick" else 400
        depth = 2 if len(target) < 40 else 3

        class Progress(xgb.callback.TrainingCallback):
            def after_iteration(self, model, epoch, evals_log):
                if epoch % 10 == 9:
                    report((epoch + 1) / rounds, f"tree {epoch + 1} of {rounds}")
                return False

        self.model = xgb.XGBRegressor(
            n_estimators=rounds,
            max_depth=depth,
            learning_rate=0.08 if opts["mode"] == "quick" else 0.03,
            subsample=0.9,
            colsample_bytree=0.9,
            min_child_weight=2,
            reg_lambda=1.0,
            random_state=0,
            n_jobs=1,
            tree_method="hist",
            callbacks=[Progress()],
        )
        self.model.fit(feats, target)
        self.settings = {"rounds": rounds, "depth": depth, "yoy": self.yoy}
        self.summary = (
            f"{rounds} trees, depth {depth}, "
            + ("learning year-on-year change" if self.yoy else "on a straight-line trend")
        )
        k = X.shape[1]
        gain = self.model.feature_importances_
        self.drivers = [float(v) for v in gain[3 : 3 + k]] if k else []
        self.driver_kind = "importance"

    def _features(self, idx, X, X_prev):
        month = month_of(idx, self.m0)
        angle = 2 * np.pi * month / SEASON
        cols = [month, np.sin(angle), np.cos(angle)]
        if X.shape[1]:
            cols.append(X - X_prev if X_prev is not None else X)
        return np.column_stack(cols)

    def predict(self, X_future, steps):
        idx = np.arange(self.n, self.n + steps)
        if self.yoy:
            X_all = np.vstack([self.X, X_future])
            feats = self._features(idx, X_all[idx], X_all[idx - SEASON])
            delta = self.model.predict(feats)
            y_all = np.concatenate([self.y, np.zeros(steps)])
            for j, i in enumerate(idx):
                y_all[i] = y_all[i - SEASON] + delta[j]
            mean = y_all[self.n :]
        else:
            feats = self._features(idx, X_future, None)
            mean = np.c_[np.ones(steps), idx] @ self.trend + self.model.predict(feats)
        return mean, None, None


# ---------------------------------------------------------------- SARIMAX


class SarimaxModel:
    """Seasonal ARIMA with the external factors as regressors."""

    QUICK = {
        True: [((1, 1, 1), (0, 1, 1, SEASON)), ((0, 1, 1), (0, 1, 1, SEASON))],
        False: [((1, 1, 1), (0, 0, 0, 0)), ((0, 1, 1), (0, 0, 0, 0))],
    }
    THOROUGH = {
        True: [
            (order, seasonal)
            for order in ((0, 1, 1), (1, 1, 0), (1, 1, 1), (2, 1, 1))
            for seasonal in ((0, 1, 1, SEASON), (1, 1, 0, SEASON))
        ],
        False: [
            (order, (0, 0, 0, 0)) for order in ((0, 1, 1), (1, 1, 0), (1, 1, 1), (2, 1, 2))
        ],
    }

    def fit(self, y, X, m0, opts, report):
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        n = len(y)
        seasonal = n >= 36
        self.scale = float(np.std(y)) or 1.0
        self.scaler = Scaler(X)
        Z = self.scaler(X)
        chosen = opts.get("settings")
        if chosen:
            candidates = [(tuple(chosen["order"]), tuple(chosen["seasonal"]))]
        elif opts["mode"] == "quick":
            candidates = self.QUICK[seasonal]
        else:
            candidates = self.THOROUGH[seasonal]

        best = None
        for i, (order, seasonal_order) in enumerate(candidates):
            label = f"{order}{seasonal_order if seasonal_order[3] else ''}"
            report(i / len(candidates), f"fitting {label}")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    result = SARIMAX(
                        y / self.scale,
                        exog=Z if self.scaler.k else None,
                        order=order,
                        seasonal_order=seasonal_order,
                    ).fit(disp=False, maxiter=60)
                if not math.isfinite(result.aic):
                    continue
            except Exception:
                continue
            if best is None or result.aic < best[0].aic:
                best = (result, order, seasonal_order)
            if opts["mode"] == "quick" and not chosen:
                break  # quick mode keeps the first candidate that fits
        if best is None:
            raise RuntimeError("SARIMAX could not be fitted to this series")
        self.result, order, seasonal_order = best
        self.settings = {"order": list(order), "seasonal": list(seasonal_order)}
        self.summary = f"order {order}" + (
            f", seasonal {seasonal_order[:3]} every {SEASON} months" if seasonal_order[3] else ""
        )
        coefs = np.asarray(self.result.params)[: self.scaler.k] * self.scale
        self.drivers = self.scaler.spread(coefs / self.scaler.sd) if self.scaler.k else []
        self.drivers += [0.0] * (X.shape[1] - len(self.drivers))
        self.driver_kind = "per-unit"

    def predict(self, X_future, steps):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            forecast = self.result.get_forecast(
                steps=steps, exog=self.scaler(X_future) if self.scaler.k else None
            )
            mean = np.asarray(forecast.predicted_mean) * self.scale
            band = np.asarray(forecast.conf_int(alpha=0.2)) * self.scale
        return mean, band[:, 0], band[:, 1]


# ---------------------------------------------------------------- Elastic Net


class ElasticNetModel:
    """Regularised linear regression on trend, month of year and the external factors."""

    def fit(self, y, X, m0, opts, report):
        from sklearn.linear_model import ElasticNet, ElasticNetCV
        from sklearn.model_selection import TimeSeriesSplit

        n = len(y)
        self.n, self.m0 = n, m0
        self.seasonal = n >= 24
        self.k = X.shape[1]
        design = self._design(np.arange(n), X)
        self.scaler = Scaler(design)
        Z = self.scaler(design)
        self.y_mean, self.y_sd = float(y.mean()), float(y.std()) or 1.0
        target = (y - self.y_mean) / self.y_sd

        chosen = opts.get("settings")
        report(0.1, "choosing the penalty")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            if chosen:
                model = ElasticNet(alpha=chosen["alpha"], l1_ratio=chosen["l1_ratio"], max_iter=20000)
            elif n >= 30:
                thorough = opts["mode"] == "thorough"
                model = ElasticNetCV(
                    l1_ratio=[0.1, 0.3, 0.5, 0.7, 0.9, 0.99] if thorough else [0.2, 0.5, 0.8],
                    alphas=100 if thorough else 40,
                    cv=TimeSeriesSplit(n_splits=5 if thorough else 3),
                    max_iter=20000,
                )
            else:
                model = ElasticNet(alpha=0.05, l1_ratio=0.5, max_iter=20000)
            model.fit(Z, target)
        self.model = model
        alpha = float(getattr(model, "alpha_", getattr(model, "alpha", 0.0)))
        l1_ratio = float(getattr(model, "l1_ratio_", getattr(model, "l1_ratio", 0.5)))
        self.settings = {"alpha": alpha, "l1_ratio": l1_ratio}
        kept = int(np.sum(np.abs(model.coef_) > 1e-9))
        self.summary = (
            f"penalty {alpha:.3g}, L1 share {l1_ratio:.2g}, "
            f"{kept} of {len(model.coef_)} terms kept"
        )
        per_unit = self.scaler.spread(model.coef_ * self.y_sd / self.scaler.sd)
        per_unit += [0.0] * (design.shape[1] - len(per_unit))
        self.drivers = per_unit[-self.k :] if self.k else []
        self.driver_kind = "per-unit"

    def _design(self, idx, X):
        idx = np.asarray(idx, float)
        if self.seasonal:
            season = month_dummies(idx.astype(int), self.m0)
        else:
            angle = 2 * np.pi * month_of(idx.astype(int), self.m0) / SEASON
            season = np.c_[np.sin(angle), np.cos(angle)]
        return np.column_stack([idx, season, X])

    def predict(self, X_future, steps):
        idx = np.arange(self.n, self.n + steps)
        Z = self.scaler(self._design(idx, X_future))
        return self.model.predict(Z) * self.y_sd + self.y_mean, None, None


# ---------------------------------------------------------------- Holt-Winters


class HoltWintersModel:
    """Holt-Winters exponential smoothing.

    Without external factors this is plain Holt-Winters on the sales history.
    With them it is fitted in two parts: a linear regression estimates the effect
    of the external factors (trend and month of year are included in that
    regression only so they are not mistaken for factor effects), Holt-Winters
    forecasts what the regression leaves over, and the forecast is the two added
    together.
    """

    def fit(self, y, X, m0, opts, report):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        n = len(y)
        seasonal = n >= 2 * SEASON
        self.scaler = Scaler(X)
        self.beta = np.zeros(0)
        remainder = y
        if self.scaler.k:
            from sklearn.linear_model import LinearRegression

            report(0.05, "regression on the external factors")
            Z = self.scaler(X)
            idx = np.arange(n)
            controls = np.c_[idx, month_dummies(idx, m0)] if seasonal else idx[:, None]
            regression = LinearRegression().fit(np.c_[Z, controls], y)
            self.beta = regression.coef_[: self.scaler.k]
            remainder = y - Z @ self.beta

        positive = bool(np.all(remainder > 0))
        chosen = opts.get("settings")
        if chosen:
            variants = [(chosen["seasonal"], chosen["damped"])]
        elif opts["mode"] == "quick" or not seasonal:
            variants = [("add" if seasonal else None, True)]
        else:
            variants = [("add", True), ("add", False)]
            if positive:
                variants += [("mul", True), ("mul", False)]

        best = None
        for i, (season_kind, damped) in enumerate(variants):
            report(0.1 + 0.9 * i / len(variants), "smoothing the remainder" if self.scaler.k else "smoothing")
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    fitted = ExponentialSmoothing(
                        remainder,
                        trend="add",
                        damped_trend=damped,
                        seasonal=season_kind,
                        seasonal_periods=SEASON if season_kind else None,
                        initialization_method="estimated",
                    ).fit()
                if not np.all(np.isfinite(fitted.fittedvalues)):
                    continue
            except Exception:
                continue
            if best is None or fitted.aic < best[0].aic:
                best = (fitted, season_kind, damped)
        if best is None:
            raise RuntimeError("Holt-Winters could not be fitted to this series")
        self.fitted, season_kind, damped = best
        self.settings = {"seasonal": season_kind, "damped": bool(damped)}
        seasonal_words = {"add": "additive seasonality", "mul": "multiplicative seasonality", None: "no seasonality"}
        self.summary = ("damped " if damped else "") + "additive trend, " + seasonal_words[season_kind]
        if self.scaler.k:
            self.summary += f", plus a regression on {self.scaler.k} external factor" + (
                "s" if self.scaler.k > 1 else ""
            )
        self.drivers = self.scaler.spread(self.beta / self.scaler.sd) if self.scaler.k else []
        self.drivers += [0.0] * (X.shape[1] - len(self.drivers))
        self.driver_kind = "per-unit"
        self._smooth = None

    def predict(self, X_future, steps):
        if self._smooth is None or len(self._smooth) < steps:
            self._smooth = np.asarray(self.fitted.forecast(steps))
        mean = self._smooth[:steps].copy()
        if self.scaler.k:
            mean = mean + self.scaler(X_future) @ self.beta
        return mean, None, None


MODELS = {
    "xgboost": XGBoostModel,
    "sarimax": SarimaxModel,
    "elasticnet": ElasticNetModel,
    "holtwinters": HoltWintersModel,
}

# Fitted models kept for the what-if, so editing a factor does not refit.
_fitted = {}


# ---------------------------------------------------------------- running


def backtest_plan(n, horizon, mode):
    """Returns (months held back per window, list of window end positions)."""
    quarter = max(1, n // 4)
    held = max(min(horizon, quarter), min(6, quarter))
    ends = [n]
    if mode == "thorough":
        step = max(3, held // 2)
        min_train = max(SEASON, n // 2)
        while len(ends) < 4 and ends[-1] - step - held >= min_train:
            ends.append(ends[-1] - step)
    return held, ends


def _arrays(spec):
    y = np.asarray(spec["y"], float)
    names = spec.get("factors", [])
    X = np.asarray(spec.get("X", []), float).reshape(len(y), len(names))
    X_future = np.asarray(spec.get("X_future", []), float).reshape(spec["horizon"], len(names))
    return y, X, X_future


def _clip(spec, values):
    if values is None:
        return None
    values = np.asarray(values, float)
    if spec.get("non_negative", True):
        values = np.maximum(values, 0.0)
    return [float(v) for v in values]


def run_model(spec, report):
    """Back-tests one model, then fits it on the full history and forecasts."""
    started = time.time()
    name = spec["model"]
    y, X, X_future = _arrays(spec)
    n, horizon, mode, m0 = len(y), spec["horizon"], spec["mode"], spec["m0"]
    held, ends = backtest_plan(n, horizon, mode)
    stages = len(ends) + 1
    opts = {"mode": mode}

    def staged(stage, label):
        def inner(fraction, message=""):
            report((stage + min(max(fraction, 0.0), 1.0)) / stages, f"{label}: {message}" if message else label)
        return inner

    folds, holdout, settings = [], None, None
    for f, end in enumerate(ends):
        label = "back-test" if len(ends) == 1 else f"back-test {f + 1} of {len(ends)}"
        progress = staged(f, label)
        progress(0.0)
        start = end - held
        model = MODELS[name]()
        model.fit(y[:start], X[:start], m0, {**opts, "settings": settings}, progress)
        if settings is None and mode == "thorough" and name in ("sarimax", "holtwinters"):
            settings = model.settings  # search once, reuse in the other windows
        mean, _, _ = model.predict(X[start:end], held)
        mean = np.asarray(_clip(spec, mean))
        folds.append({"start": int(start), "months": int(held), **metrics(y[start:end], mean)})
        if f == 0:
            holdout = {"start": int(start), "predicted": [float(v) for v in mean]}

    progress = staged(len(ends), "final fit on all history")
    progress(0.0)
    final = MODELS[name]()
    final.fit(y, X, m0, {**opts, "settings": settings}, progress)
    mean, lower, upper = final.predict(X_future, horizon)
    scores = average_metrics(folds)
    band = "model"
    if lower is None:
        spread = Z80 * (scores["rmse"] or 0.0)
        lower, upper, band = np.asarray(mean) - spread, np.asarray(mean) + spread, "backtest"
    _fitted[spec["key"]] = final
    report(1.0, "done")
    return {
        "model": name,
        "metrics": scores,
        "folds": folds,
        "holdout": holdout,
        "forecast": _clip(spec, mean),
        "lower": _clip(spec, lower),
        "upper": _clip(spec, upper),
        "band": band,
        "summary": final.summary,
        "settings": final.settings,
        "drivers": final.drivers,
        "driverKind": final.driver_kind,
        "seconds": time.time() - started,
    }


def what_if(spec, report):
    """Forecasts again with edited future factor values, refitting only if needed."""
    final = _fitted.get(spec["key"])
    y, X, X_future = _arrays(spec)
    refitted = False
    if final is None:
        report(0.0, "refitting the model")
        final = MODELS[spec["model"]]()
        final.fit(y, X, spec["m0"], {"mode": spec["mode"], "settings": spec.get("settings")}, report)
        _fitted.clear()  # keep one fitted model in memory at a time per worker
        _fitted[spec["key"]] = final
        refitted = True
    scenario = np.asarray(spec["X_scenario"], float).reshape(spec["horizon"], X.shape[1])
    baseline, _, _ = final.predict(X_future, spec["horizon"])
    edited, _, _ = final.predict(scenario, spec["horizon"])
    return {
        "model": spec["model"],
        "baseline": _clip(spec, baseline),
        "scenario": _clip(spec, edited),
        "refitted": refitted,
    }


def forget(prefix=""):
    for key in [k for k in _fitted if k.startswith(prefix)]:
        del _fitted[key]
