"""Tests de terreno y RUSLE con superficies sintéticas (sin red)."""
import numpy as np
import pandas as pd
import pytest

from app import engine, terrain


def test_dem_uses_persistent_cache(monkeypatch, tmp_path):
    """A fresh worker writes outside the release, and another worker reuses it."""
    import os
    import subprocess
    import sys

    cache = tmp_path / "persistent" / "terrain"
    env = {**os.environ, "NASA_CACHE_DIR": str(cache)}
    code = """
import os
from pathlib import Path
from app import terrain
def download(*_):
    return [80.0] * terrain.GRID_N ** 2
terrain._download_dem = download
result = terrain.fetch_dem(-32.62, -57.75, 100)
assert result['z'].shape == (terrain.GRID_N, terrain.GRID_N)
assert list(Path(os.environ['NASA_CACHE_DIR']).glob('dem_*.json'))
"""
    subprocess.run([sys.executable, "-c", code], env=env, check=True)
    code = code.replace("return [80.0] * terrain.GRID_N ** 2", "raise AssertionError('Should reuse disk cache')")
    subprocess.run([sys.executable, "-c", code], env=env, check=True)


@pytest.fixture(scope="module")
def cat():
    return engine.load_catalog()


def dem_from(z, cell=50.0):
    return {"z": z.astype(float), "cell_m": cell}


def plane(slope_pct, n=terrain.GRID_N, cell=50.0):
    x = np.arange(n) * cell
    return np.tile(-x * slope_pct / 100, (n, 1))  # baja hacia el este


def test_slope_of_plane():
    t = terrain.analyze_terrain(dem_from(plane(4)))
    assert t["slope_pct"][3:-3, 3:-3] == pytest.approx(4, abs=0.05)


def test_flow_accumulates_downhill():
    acc = terrain.d8_accumulation(plane(4), 50.0)
    assert (acc[:, -1] > acc[:, 0]).all()   # la columna más baja recibe todo


def test_steeper_means_more_erosion():
    gentle = terrain.analyze_terrain(dem_from(plane(1)))
    steep = terrain.analyze_terrain(dem_from(plane(6)))
    assert terrain.erosion_map(steep, 5000, 0.2).mean() > terrain.erosion_map(gentle, 5000, 0.2).mean()


def test_cover_lowers_c_factor(cat):
    frac = [1 / 12] * 12
    c_soja = terrain.c_factor(cat.rotations["soja_continua"], cat.crops, frac)
    c_cob = terrain.c_factor(cat.rotations["soja_cobertura"], cat.crops, frac)
    c_pastura = terrain.c_factor(cat.rotations["pradera_verdeos"], cat.crops, frac)
    assert c_pastura < c_cob < c_soja


def test_r_factor_fractions_sum_to_one():
    idx = pd.date_range("2000-01-01", "2004-12-31", freq="D")
    rng = np.random.default_rng(1)
    daily = pd.DataFrame({"rain": rng.exponential(3.5, len(idx))}, index=idx)
    r, frac = terrain.r_factor(daily)
    assert r > 0
    assert sum(frac) == pytest.approx(1.0)
    assert len(frac) == 12


def test_field_grid_area():
    lats, lons, cell_m, bounds, _ = terrain.field_grid(-33.0, -57.0, 100)
    assert cell_m * terrain.GRID_N == pytest.approx(1000, rel=1e-6)
    assert lats[0] > lats[-1] and lons[0] < lons[-1]
