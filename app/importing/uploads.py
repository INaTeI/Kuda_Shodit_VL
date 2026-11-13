"""Bounded file parsing shared by preview and apply, outside the event loop."""

from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, BadZipFile
from xml.etree.ElementTree import ParseError
from openpyxl.utils.exceptions import InvalidFileException
from defusedxml.common import DefusedXmlException
from app.importing.excel import read_plan

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_UNPACKED_BYTES = 20 * 1024 * 1024


def parse_upload(content: bytes, file_name: str):
    if not content:
        raise ValueError("Файл пустой")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("Файл превышает 5 МБ")
    suffix = Path(file_name).suffix.lower()
    if suffix not in {".xlsx", ".xlsm"}:
        raise ValueError("Нужен файл .xlsx или .xlsm")
    with TemporaryDirectory(prefix="vdk-import-") as directory:
        path = Path(directory) / ("upload" + suffix)
        path.write_bytes(content)
        try:
            with ZipFile(path) as archive:
                members = archive.infolist()
                names = {item.filename for item in members}
                if (
                    len(members) > 2000
                    or sum(item.file_size for item in members) > MAX_UNPACKED_BYTES
                ):
                    raise ValueError(
                        "Превышен лимит распакованной книги: 20 МБ или 2000 файлов"
                    )
                if any(item.flag_bits & 1 for item in members):
                    raise ValueError("Зашифрованные книги не поддерживаются")
                if not {"[Content_Types].xml", "xl/workbook.xml"}.issubset(names):
                    raise ValueError("Файл не является книгой Excel")
            plan = read_plan(path)
        except (
            BadZipFile,
            InvalidFileException,
            ParseError,
            DefusedXmlException,
            KeyError,
            TypeError,
            StopIteration,
            OSError,
        ) as error:
            raise ValueError(
                "Не удалось прочитать книгу Excel: файл повреждён или имеет неверную структуру"
            ) from error
    plan.file_name = file_name
    for item in plan.places:
        item.values["source_data"]["file_name"] = file_name
    return plan
