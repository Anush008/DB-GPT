import logging
import os
import shutil

from fastapi import APIRouter, Body, Depends

from dbgpt._private.config import Config
from dbgpt_app.openapi.api_view_model import Result
from dbgpt_serve.utils.auth import UserRequest, get_user_from_headers

router = APIRouter()
CFG = Config()
logger = logging.getLogger(__name__)

# Map of example IDs to their file paths (relative to project root)
EXAMPLE_FILES = {
    "walmart_sales": {
        "path": "docker/examples/excel/Walmart_Sales.csv",
        "name": "Walmart_Sales.csv",
    },
    "csv_visual_report": {
        "path": "docker/examples/excel/Walmart_Sales.csv",
        "name": "Walmart_Sales.csv",
    },
    "fin_report": {
        "path": (
            "docker/examples/fin_report/pdf/"
            "2020-01-23__浙江海翔药业股份有限公司__002099__海翔药业__2019年__年度报告.pdf"
        ),
        "name": (
            "2020-01-23__浙江海翔药业股份有限公司__002099__海翔药业__2019年__年度报告.pdf"
        ),
    },
    "create_sql_skill": {
        "path": "docker/examples/txt/sql_skill.txt",
        "name": "sql_skill.txt",
    },
}


@router.post("/v1/examples/use", response_model=Result[str])
async def use_example_file(
    example_id: str = Body(..., embed=True),
    user_token: UserRequest = Depends(get_user_from_headers),
):
    """Copy an example file to user's upload directory and return its path."""
    try:
        if example_id not in EXAMPLE_FILES:
            return Result.failed(msg=f"Unknown example: {example_id}")

        example = EXAMPLE_FILES[example_id]
        user_id = user_token.user_id or "default"

        # Determine base directory
        base_dir = os.getcwd()
        if (
            CFG.SYSTEM_APP
            and hasattr(CFG.SYSTEM_APP, "work_dir")
            and CFG.SYSTEM_APP.work_dir
        ):
            base_dir = CFG.SYSTEM_APP.work_dir

        # Source file - try base_dir first, then project root
        source_path = os.path.join(base_dir, example["path"])
        if not os.path.exists(source_path):
            project_root = os.path.dirname(
                os.path.dirname(
                    os.path.dirname(
                        os.path.dirname(
                            os.path.dirname(
                                os.path.dirname(
                                    os.path.dirname(os.path.abspath(__file__))
                                )
                            )
                        )
                    )
                )
            )
            source_path = os.path.join(project_root, example["path"])

        if not os.path.exists(source_path):
            return Result.failed(msg=f"Example file not found: {example['name']}")

        # Target directory - same as python_upload_api
        upload_dir = os.path.join(base_dir, "python_uploads", user_id)
        os.makedirs(upload_dir, exist_ok=True)

        target_path = os.path.join(upload_dir, example["name"])
        shutil.copy2(source_path, target_path)

        abs_path = os.path.abspath(target_path)
        logger.info(f"Example file copied: {abs_path}")
        return Result.succ(abs_path)
    except Exception as e:
        logger.exception(f"Failed to use example file: {e}")
        return Result.failed(msg=f"Error: {str(e)}")
