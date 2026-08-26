import os

# CI and local tests stay hermetic: the app boots on the deterministic route
# unless a test explicitly overrides it (see test_real_minimax).
os.environ.setdefault("RESO_MODEL_ROUTE", "deterministic")
