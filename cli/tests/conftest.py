"""pytest config: make the cli/ dir importable for tests."""
import sys
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parent
if str(CLI_ROOT) not in sys.path:
    sys.path.insert(0, str(CLI_ROOT))
