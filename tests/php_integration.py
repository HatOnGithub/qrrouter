"""Compatibility entrypoint for the current Angular/PHP/C# integration tests."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name('angular_integration.py')), run_name='__main__')
