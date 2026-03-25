"""Hatch build hook for dbgpt-app.

Dynamically resolves force-include paths for wheel builds based on the build
mode. This is necessary because source paths differ between editable installs
(where files live at the repository root) and standard builds from sdist
(where files have been copied into the sdist archive).

Problem solved:
  - editable (uv sync): root = packages/dbgpt-app/, files at ../../skills/
  - standard (from sdist): root = /tmp/extracted-sdist/, files at skills/
  Static pyproject.toml force-include cannot handle both cases.
"""

from __future__ import annotations

import os
from pathlib import Path

from hatchling.builders.hooks.plugin.interface import BuildHookInterface


# Source paths relative to REPO ROOT -> wheel target paths
# Used in editable mode where we can reach repo root via ../../
_SKILLS_MAP = {
    "skills/csv-data-analysis": "dbgpt_app/_builtin_skills/csv-data-analysis",
    "skills/skill-creator": "dbgpt_app/_builtin_skills/skill-creator",
    "skills/financial-report-analyzer": "dbgpt_app/_builtin_skills/financial-report-analyzer",
    "skills/walmart-sales-analyzer": "dbgpt_app/_builtin_skills/walmart-sales-analyzer",
    "skills/agent-browser": "dbgpt_app/_builtin_skills/agent-browser",
}

_EXAMPLES_MAP = {
    # repo_root_relative_path -> wheel_target
    "docker/examples/excel/Walmart_Sales.csv": "dbgpt_app/_builtin_examples/excel/Walmart_Sales.csv",
    "docker/examples/fin_report/pdf/2020-01-23__浙江海翔药业股份有限公司__002099__海翔药业__2019年__年度报告.pdf": "dbgpt_app/_builtin_examples/fin_report/pdf/2020-01-23__浙江海翔药业股份有限公司__002099__海翔药业__2019年__年度报告.pdf",
}

_PILOT_TPL_MAP = {
    # repo_root_relative_path -> wheel_target
    "pilot/meta_data/alembic.ini": "dbgpt_app/pilot_template/meta_data/alembic.ini",
    "pilot/meta_data/alembic/README": "dbgpt_app/pilot_template/meta_data/alembic/README",
    "pilot/meta_data/alembic/env.py": "dbgpt_app/pilot_template/meta_data/alembic/env.py",
    "pilot/meta_data/alembic/script.py.mako": "dbgpt_app/pilot_template/meta_data/alembic/script.py.mako",
    "pilot/benchmark_meta_data/2025_07_27_public_500_standard_benchmark_question_list.xlsx": "dbgpt_app/pilot_template/benchmark_meta_data/2025_07_27_public_500_standard_benchmark_question_list.xlsx",
    "pilot/examples/Walmart_Sales.db": "dbgpt_app/pilot_template/examples/Walmart_Sales.db",
}

# sdist force-include remaps these paths:
#   ../../skills/X           -> skills/X
#   ../../docker/examples/X  -> examples/X
#   ../../pilot/X            -> pilot_tpl/X
_SDIST_REMAP = {
    "skills/": "skills/",  # no change
    "docker/examples/": "examples/",  # strip "docker/"
    "pilot/": "pilot_tpl/",  # pilot -> pilot_tpl
}


class CustomBuildHook(BuildHookInterface):
    """Dynamically set wheel force-include paths for editable and standard builds."""

    def initialize(self, version, build_data):
        """Called by hatchling before building.

        Args:
            version: "editable" for uv sync / pip install -e .
                     "standard" for uv build / pip wheel
            build_data: mutable dict; set "force_include" key to inject mappings
        """
        pkg_root = Path(self.root)  # packages/dbgpt-app/
        all_mappings = {**_SKILLS_MAP, **_EXAMPLES_MAP, **_PILOT_TPL_MAP}
        force_include = {}

        if version == "editable":
            # Editable: resolve from repo root (two levels up from packages/dbgpt-app/)
            repo_root = pkg_root.parent.parent
            for repo_rel_path, wheel_target in all_mappings.items():
                source = str(repo_root / repo_rel_path)
                if os.path.exists(source):
                    force_include[source] = wheel_target
        else:
            # Standard build from sdist: files were placed at sdist-relative paths
            # by the sdist force-include config in pyproject.toml
            for repo_rel_path, wheel_target in all_mappings.items():
                sdist_path = repo_rel_path
                for prefix, replacement in _SDIST_REMAP.items():
                    if repo_rel_path.startswith(prefix):
                        sdist_path = replacement + repo_rel_path[len(prefix) :]
                        break
                source = str(pkg_root / sdist_path)
                if os.path.exists(source):
                    force_include[source] = wheel_target

        build_data["force_include"] = force_include
